import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DataSource, EntityManager, Repository } from 'typeorm'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReportVersion } from './entities/support-hours-report-version.entity'
import type { SupportHoursPackageReportService } from './support-hours-package-report.service'
import { SupportHoursReportVersionsService } from './support-hours-report-versions.service'

describe('SupportHoursReportVersionsService', () => {
  let directory: string
  let rows: SupportHoursReportVersion[]
  let service: SupportHoursReportVersionsService
  let generate: jest.Mock
  let findOne: jest.Mock
  let save: jest.Mock
  let packageFindOne: jest.Mock
  let transaction: jest.Mock
  let manager: EntityManager
  const pdf = Buffer.from('%PDF-1.7\nImmutable client report\n%%EOF')

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'support-pdf-versions-'))
    rows = []
    findOne = jest.fn(({ where, order }: { where: Partial<SupportHoursReportVersion>; order?: { versionNumber: string } }) => Promise.resolve(
      [...rows].filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof SupportHoursReportVersion] === value))
        .sort((a, b) => order ? b.versionNumber - a.versionNumber : 0)[0] ?? null,
    ))
    save = jest.fn((row: SupportHoursReportVersion) => {
      const persisted = Object.assign(new SupportHoursReportVersion(), row, {
        id: rows.length + 1,
        // Simulate a database default using Moscow local time as a UTC value.
        createdAt: row.createdAt ?? new Date(Date.now() + 3 * 60 * 60 * 1000),
      })
      rows.push(persisted)
      return Promise.resolve(persisted)
    })
    const repository = {
      findOne,
      find: jest.fn(({ where }: { where: Partial<SupportHoursReportVersion> }) => Promise.resolve(rows.filter((row) => Object.entries(where).every(([key, value]) => row[key as keyof SupportHoursReportVersion] === value)))),
      create: (data: Partial<SupportHoursReportVersion>) => Object.assign(new SupportHoursReportVersion(), data),
      save,
    } as unknown as Repository<SupportHoursReportVersion>
    packageFindOne = jest.fn().mockResolvedValue({ id: 7, projectId: 31 })
    manager = { getRepository: (entity: unknown) => entity === SupportHoursPackage ? { findOne: packageFindOne } : repository } as unknown as EntityManager
    transaction = jest.fn((callback: (value: EntityManager) => Promise<unknown>) => callback(manager))
    generate = jest.fn().mockResolvedValue({
      buffer: pdf, filename: 'live.pdf',
      snapshot: { packageId: 7, projectId: 31, projectTitle: 'АО МРК ТП', clientName: 'АО МРК', purchasedHours: 80, spentHours: 9.5, remainingHours: 70.5 },
    })
    service = new SupportHoursReportVersionsService(
      repository, { transaction } as unknown as DataSource,
      { generate } as unknown as SupportHoursPackageReportService,
      { get: () => directory } as unknown as ConfigService,
    )
  })

  afterEach(async () => {
    jest.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  })

  it('persists the UTC creation instant explicitly instead of using the database session clock', async () => {
    const actualTime = new Date('2026-09-29T10:46:00.000Z')
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(actualTime)
    const version = await service.create(7, { requestId: randomUUID() })
    expect(save.mock.calls[0][0].createdAt).toEqual(actualTime)
    expect(version.createdAt.toISOString()).toBe('2026-09-29T10:46:00.000Z')
    expect((await service.list(31))[0].createdAt).toEqual(actualTime)
  })

  it('saves exact bytes and snapshot totals; later edits never regenerate a saved download', async () => {
    const version = await service.create(7, { requestId: randomUUID() })
    generate.mockResolvedValue({ buffer: Buffer.from('%PDF-1.7\nChanged report'), snapshot: { spentHours: 20 } })

    const downloaded = await service.download(version.id)
    expect(downloaded.buffer.equals(pdf)).toBe(true)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(version).toMatchObject({ versionNumber: 1, filename: 'support-package-7-v1.pdf', spentHours: 9.5, remainingHours: 70.5, projectTitle: 'АО МРК ТП' })
    expect(version).not.toHaveProperty('storageFilename')
    expect(version.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(packageFindOne).toHaveBeenCalledWith({ where: { id: 7 }, lock: { mode: 'pessimistic_write' } })
    expect(await readdir(directory)).toHaveLength(1)
  })

  it('coalesces repeated clicks and replays the same idempotency key without another file', async () => {
    const dto = { requestId: randomUUID() }
    const [first, parallel] = await Promise.all([service.create(7, dto), service.create(7, dto)])
    const retried = await service.create(7, dto)
    expect([parallel.id, retried.id]).toEqual([first.id, first.id])
    expect(generate).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(await readdir(directory)).toHaveLength(1)
  })

  it('rejects reuse of an idempotency key for another package', async () => {
    const dto = { requestId: randomUUID() }
    await service.create(7, dto)
    await expect(service.create(8, dto)).rejects.toBeInstanceOf(ConflictException)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('keeps versions downloadable and project-listed after the live package is removed', async () => {
    const version = await service.create(7, { requestId: randomUUID() })
    packageFindOne.mockResolvedValue(null)
    generate.mockRejectedValue(new NotFoundException())
    expect(await service.list(31)).toEqual([version])
    expect(await service.list(99)).toEqual([])
    expect((await service.download(version.id)).buffer.equals(pdf)).toBe(true)
    expect(packageFindOne).toHaveBeenCalledTimes(1)
  })

  it('numbers subsequent versions while preserving earlier bytes', async () => {
    const first = await service.create(7, { requestId: randomUUID() })
    const second = await service.create(7, { requestId: randomUUID() })
    expect([first.versionNumber, second.versionNumber]).toEqual([1, 2])
    expect(await readdir(directory)).toHaveLength(2)
  })

  it('cleans up an unpublished file if its database insert fails', async () => {
    save.mockRejectedValue(new Error('database write failed'))
    await expect(service.create(7, { requestId: randomUUID() })).rejects.toThrow('database write failed')
    expect(await readdir(directory)).toEqual([])
  })

  it('does not delete a committed document when the connection is lost after commit', async () => {
    transaction.mockImplementation(async (callback: (value: EntityManager) => Promise<unknown>) => {
      await callback(manager)
      throw new Error('connection lost after commit')
    })
    const version = await service.create(7, { requestId: randomUUID() })
    expect((await service.download(version.id)).buffer.equals(pdf)).toBe(true)
    expect(await readdir(directory)).toHaveLength(1)
  })

  it('refuses a modified archived PDF instead of silently generating a replacement', async () => {
    const version = await service.create(7, { requestId: randomUUID() })
    await writeFile(join(directory, rows[0].storageFilename), '%PDF-1.7\nTampered')
    await expect(service.download(version.id)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('refuses invalid storage paths even if a stored database value was corrupted', async () => {
    const version = await service.create(7, { requestId: randomUUID() })
    const originalPath = join(directory, rows[0].storageFilename)
    rows[0].storageFilename = '../secret.pdf'
    await expect(service.download(version.id)).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect((await readFile(originalPath)).equals(pdf)).toBe(true)
  })

  it('does not archive non-PDF output', async () => {
    generate.mockResolvedValue({ buffer: Buffer.from('<html>error</html>'), snapshot: {} })
    await expect(service.create(7, { requestId: randomUUID() })).rejects.toBeInstanceOf(ServiceUnavailableException)
    expect(save).not.toHaveBeenCalled()
    expect(await readdir(directory)).toEqual([])
  })
})
