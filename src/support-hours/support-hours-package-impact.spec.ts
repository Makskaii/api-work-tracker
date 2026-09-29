import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PreviewSupportHoursPackageDto } from './dto/preview-support-hours-package.dto'
import { UpdateSupportHoursPackageDto } from './dto/update-support-hours-package.dto'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursAssignment } from './entities/support-hours-assignment.entity'
import { SupportTaskAssignment } from './entities/support-task-assignment.entity'
import { SupportHoursTransfer } from './entities/support-hours-transfer.entity'
import { SupportHoursPackageImpactService } from './support-hours-package-impact.service'
import { SupportHoursPackagesService } from './support-hours-packages.service'

type Allocation = { packageId: number; reportId: number; hours: number }
const pack = (id: number, purchasedHours: number, purchaseDate = '2026-09-01'): SupportHoursPackage => Object.assign(new SupportHoursPackage(), {
  id, projectId: 10, purchasedHours, purchaseDate, amount: null, comment: null,
  updatedAt: new Date('2026-09-01T08:00:00Z'),
})
const report = (id: number, hours: number, reportDate = '2026-09-10T08:00:00Z'): SupportHoursReport => Object.assign(new SupportHoursReport(), {
  id, bitrixReportId: String(id), projectId: 10, hours, reportDate: new Date(reportDate),
})

function fixture(
  packages = [pack(1, 10), pack(2, 10, '2026-09-15')],
  reports = [report(1, 8), report(2, 7, '2026-09-11T08:00:00Z')],
  rows: Allocation[] = [{ packageId: 1, reportId: 1, hours: 8 }, { packageId: 1, reportId: 2, hours: 2 }, { packageId: 2, reportId: 2, hours: 5 }],
) {
  const packageRepo = {
    findOne: jest.fn(({ where }) => Promise.resolve(packages.find((item) => item.id === where.id) ?? null)),
    find: jest.fn(({ where }) => Promise.resolve(packages.filter((item) => item.projectId === where.projectId)
      .map((item) => ({ ...item, consumptions: rows.filter((row) => row.packageId === item.id) })))),
    save: jest.fn(), remove: jest.fn(), update: jest.fn(), delete: jest.fn(),
  }
  const reportRepo = {
    find: jest.fn(({ where }) => Promise.resolve(reports.filter((item) => item.projectId === where.projectId))),
    save: jest.fn(), remove: jest.fn(), update: jest.fn(), delete: jest.fn(),
  }
  const consumptionRepo = { create: jest.fn((value) => value), delete: jest.fn().mockResolvedValue({}), save: jest.fn().mockResolvedValue([]) }
  const assignments: SupportHoursAssignment[] = []
  const taskAssignments: SupportTaskAssignment[] = []
  const assignmentRepo = { find: jest.fn(async () => assignments) }
  const taskAssignmentRepo = { find: jest.fn(async () => taskAssignments) }
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === SupportHoursPackage) return packageRepo
      if (entity === SupportHoursReport) return reportRepo
      if (entity === SupportHoursConsumption) return consumptionRepo
      if (entity === SupportHoursAssignment) return assignmentRepo
      if (entity === SupportTaskAssignment) return taskAssignmentRepo
      if (entity === SupportHoursTransfer) return { findOne: jest.fn().mockResolvedValue(null) }
      throw new Error('Unexpected repository')
    },
  }
  const dataSource = { getRepository: manager.getRepository, transaction: jest.fn(async (operation) => await operation(manager)) }
  return {
    service: new SupportHoursPackageImpactService(dataSource as never),
    packages, reports, rows, packageRepo, reportRepo, consumptionRepo, dataSource, assignments, taskAssignments,
  }
}

describe('Support package edit and deletion impact', () => {
  it('shows hours moving into the next package without modifying persisted records', async () => {
    const context = fixture()
    const before = JSON.stringify([context.packages, context.reports, context.rows])
    const result = await context.service.preview(1, { operation: 'update', changes: { purchasedHours: 7 } })

    expect(result).toMatchObject({
      packageId: 1, projectId: 10, requiresConfirmation: true, movedHours: 3, movedReportCount: 2,
      unallocatedHoursBefore: 0, unallocatedHoursAfter: 0,
      packages: [
        { id: 1, before: { purchasedHours: 10, consumedHours: 10, remainingHours: 0, reportCount: 2 }, after: { purchasedHours: 7, consumedHours: 7, remainingHours: 0, reportCount: 1 }, affected: true },
        { id: 2, before: { purchasedHours: 10, consumedHours: 5, remainingHours: 5, reportCount: 1 }, after: { purchasedHours: 10, consumedHours: 8, remainingHours: 2, reportCount: 2 }, affected: true },
      ],
    })
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify([context.packages, context.reports, context.rows])).toBe(before)
    for (const repository of [context.packageRepo, context.reportRepo]) {
      for (const method of ['save', 'remove', 'update', 'delete'] as const) expect(repository[method]).not.toHaveBeenCalled()
    }
  })

  it('moves all work after deleting an earlier package and preserves overrun on the last package', async () => {
    const { service } = fixture()
    const result = await service.preview(1, { operation: 'delete' })
    expect(result).toMatchObject({
      movedHours: 10, movedReportCount: 2, requiresConfirmation: true, unallocatedHoursAfter: 0,
      packages: [{ id: 1, after: null }, { id: 2, after: { consumedHours: 15, remainingHours: -5 } }],
    })
  })

  it('keeps reports and reports unallocated work when the only remaining package is deleted', async () => {
    const { service, reports } = fixture([pack(1, 10)], [report(1, 12)], [{ packageId: 1, reportId: 1, hours: 12 }])
    const result = await service.preview(1, { operation: 'delete' })
    expect(result).toMatchObject({
      movedHours: 12, movedReportCount: 1, unallocatedHoursBefore: 0, unallocatedHoursAfter: 12,
      packages: [{ id: 1, before: { remainingHours: -2 }, after: null }],
    })
    expect(reports).toHaveLength(1)
  })

  it('reorders packages by their proposed purchase date, independent of input order', async () => {
    const { service, packages } = fixture()
    packages.reverse()
    const result = await service.preview(2, { operation: 'update', changes: { purchaseDate: '2026-08-01' } })
    expect(result).toMatchObject({
      movedHours: 11, movedReportCount: 2,
      packages: [{ id: 1, after: { consumedHours: 5, remainingHours: 5 } }, { id: 2, purchaseDate: '2026-08-01', after: { consumedHours: 10, remainingHours: 0 } }],
    })
  })

  it('uses report date followed by report ID and rounds allocation rows to hundredths', async () => {
    const { service } = fixture([pack(1, 0.3), pack(2, 1)], [report(2, 0.2), report(1, 0.1)], [
      { packageId: 1, reportId: 1, hours: 0.1 }, { packageId: 1, reportId: 2, hours: 0.2 },
    ])
    const result = await service.preview(1, { operation: 'update', changes: { purchasedHours: 0.1 } })
    expect(result).toMatchObject({
      movedHours: 0.2, movedReportCount: 1,
      packages: [{ id: 1, after: { consumedHours: 0.1, remainingHours: 0, reportCount: 1 } }, { id: 2, after: { consumedHours: 0.2, remainingHours: 0.8, reportCount: 1 } }],
    })
  })

  it('does not require a confirmation for a comment-only update or an unused package', async () => {
    const { service } = fixture()
    const changes = { operation: 'update' as const, changes: { comment: '' } }
    await expect(service.preview(1, changes)).resolves.toMatchObject({ requiresConfirmation: false, movedHours: 0, movedReportCount: 0 })
    await expect(service.assertPreview(1, changes)).resolves.toBeUndefined()
    const unused = fixture([pack(1, 10)], [], [])
    await expect(unused.service.assertPreview(1, { operation: 'delete' })).resolves.toBeUndefined()
  })

  it('requires confirmation when an unused package is moved earlier and absorbs existing work', async () => {
    const { service } = fixture([pack(1, 10), pack(2, 10, '2026-09-15')], [report(1, 8)], [{ packageId: 1, reportId: 1, hours: 8 }])
    const request = { operation: 'update' as const, changes: { purchaseDate: '2026-08-01' } }
    await expect(service.preview(2, request)).resolves.toMatchObject({ requiresConfirmation: true, movedHours: 8, movedReportCount: 1 })
    await expect(service.assertPreview(2, request)).rejects.toBeInstanceOf(ConflictException)
  })

  it('requires a matching preview for an allocation-changing edit and rejects changed request values', async () => {
    const { service } = fixture()
    const request = { operation: 'update' as const, changes: { purchasedHours: 7 } }
    await expect(service.assertPreview(1, request)).rejects.toBeInstanceOf(ConflictException)
    const preview = await service.preview(1, request)
    await expect(service.assertPreview(1, request, preview.fingerprint)).resolves.toBeUndefined()
    await expect(service.assertPreview(1, request, `"${preview.fingerprint}"`)).resolves.toBeUndefined()
    await expect(service.assertPreview(1, { ...request, changes: { purchasedHours: 6 } }, preview.fingerprint)).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects a preview after another report or package changes', async () => {
    const context = fixture()
    const request = { operation: 'delete' as const }
    const preview = await context.service.preview(1, request)
    context.reports.push(report(3, 3))
    await expect(context.service.assertPreview(1, request, preview.fingerprint)).rejects.toBeInstanceOf(ConflictException)
    const next = await context.service.preview(1, request)
    context.packages[1].purchasedHours = 20
    await expect(context.service.assertPreview(1, request, next.fingerprint)).rejects.toBeInstanceOf(ConflictException)
  })

  it('also checks a supplied fingerprint for an otherwise unconfirmed comment-only edit', async () => {
    const { service, packages } = fixture()
    const request = { operation: 'update' as const, changes: { comment: null } }
    const preview = await service.preview(1, request)
    packages[0].comment = 'Another analyst edited this'
    await expect(service.assertPreview(1, request, preview.fingerprint)).rejects.toBeInstanceOf(ConflictException)
  })

  it('rejects missing packages and delete requests that contain field changes', async () => {
    const { service } = fixture()
    await expect(service.preview(999, { operation: 'delete' })).rejects.toBeInstanceOf(NotFoundException)
    await expect(service.preview(1, { operation: 'delete', changes: {} })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('validates nested proposed changes before accepting a preview request', async () => {
    const invalid = plainToInstance(PreviewSupportHoursPackageDto, { operation: 'update', changes: { purchasedHours: -1 } })
    const missing = plainToInstance(PreviewSupportHoursPackageDto, { operation: 'update' })
    const valid = plainToInstance(PreviewSupportHoursPackageDto, { operation: 'update', changes: { purchasedHours: 30, comment: null } })
    expect(await validate(invalid)).not.toHaveLength(0)
    expect(await validate(missing)).not.toHaveLength(0)
    expect(await validate(valid)).toHaveLength(0)
  })

  it('rejects null hours or date without preventing optional fields or clearing a comment', async () => {
    for (const changes of [{ purchasedHours: null }, { purchaseDate: null }]) {
      const update = plainToInstance(UpdateSupportHoursPackageDto, changes)
      const preview = plainToInstance(PreviewSupportHoursPackageDto, { operation: 'update', changes })
      expect(await validate(update)).not.toHaveLength(0)
      expect(await validate(preview)).not.toHaveLength(0)
    }
    expect(await validate(plainToInstance(UpdateSupportHoursPackageDto, { comment: null, amount: null }))).toHaveLength(0)
    expect(await validate(plainToInstance(UpdateSupportHoursPackageDto, {}))).toHaveLength(0)
  })

  it.each(['update', 'delete'] as const)('prevents an actual package %s after the confirmed report data becomes stale', async (operation) => {
    const context = fixture()
    const packages = new SupportHoursPackagesService({} as never, context.packageRepo as never, context.reportRepo as never,
      context.consumptionRepo as never, context.dataSource as never, {} as never, context.service)
    const request = operation === 'update' ? { operation, changes: { purchasedHours: 7 } } : { operation }
    const confirmation = await context.service.preview(1, request)
    context.reports[0].hours = 9
    const mutation = operation === 'update'
      ? packages.update(1, { purchasedHours: 7 }, confirmation.fingerprint)
      : packages.remove(1, confirmation.fingerprint)
    await expect(mutation).rejects.toBeInstanceOf(ConflictException)
    expect(context.packages[0].purchasedHours).toBe(10)
    expect(context.packageRepo.save).not.toHaveBeenCalled()
    expect(context.packageRepo.remove).not.toHaveBeenCalled()
    expect(context.consumptionRepo.delete).not.toHaveBeenCalled()
  })

  it('checks the confirmed preview after earlier queued mutations finish, before writing any new package values', async () => {
    const context = fixture()
    const packages = new SupportHoursPackagesService({} as never, context.packageRepo as never, context.reportRepo as never,
      context.consumptionRepo as never, context.dataSource as never, {} as never, context.service)
    const confirmation = await context.service.preview(1, { operation: 'update', changes: { purchasedHours: 7 } })
    const assertPreview = jest.spyOn(context.service, 'assertPreview')
    let releaseSave!: () => void
    let notifySaveStarted!: () => void
    const saving = new Promise<void>((resolve) => { releaseSave = resolve })
    const saveStarted = new Promise<void>((resolve) => { notifySaveStarted = resolve })
    context.packageRepo.save.mockImplementation(async (item) => {
      notifySaveStarted()
      await saving
      return item
    })
    const first = packages.update(1, { comment: 'Changed by another analyst' })
    await saveStarted
    const second = packages.update(1, { purchasedHours: 7 }, confirmation.fingerprint)
    const rejected = expect(second).rejects.toBeInstanceOf(ConflictException)
    expect(assertPreview).toHaveBeenCalledTimes(1)
    releaseSave()
    await first
    await rejected
    expect(assertPreview).toHaveBeenCalledTimes(2)
    expect(context.packageRepo.save).toHaveBeenCalledTimes(1)
    expect(context.packages[0].purchasedHours).toBe(10)
  })

  it('leaves manual work unallocated after its target package is deleted rather than moving it by FIFO', async () => {
    const context = fixture([pack(1, 10), pack(2, 10)], [report(1, 4)], [{ packageId: 1, reportId: 1, hours: 4 }])
    context.assignments.push(Object.assign(new SupportHoursAssignment(), { projectId: 10, bitrixReportId: '1', allocations: [{ packageId: 1, hours: 4 }] }))
    const result = await context.service.preview(1, { operation: 'delete' })
    expect(result).toMatchObject({ movedHours: 4, unallocatedHoursAfter: 4, packages: [{ id: 1, after: null }, { id: 2, after: { consumedHours: 0, remainingHours: 10 } }] })
    expect(context.assignments[0].allocations).toEqual([{ packageId: 1, hours: 4 }])
  })

  it('caps manual work at the reduced package capacity while preserving an unallocated remainder', async () => {
    const context = fixture([pack(1, 10)], [report(1, 5)], [{ packageId: 1, reportId: 1, hours: 5 }])
    context.assignments.push(Object.assign(new SupportHoursAssignment(), { projectId: 10, bitrixReportId: '1', allocations: [{ packageId: 1, hours: 5 }] }))
    expect(await context.service.preview(1, { operation: 'update', changes: { purchasedHours: 3 } })).toMatchObject({
      movedHours: 2, unallocatedHoursAfter: 2, packages: [{ id: 1, after: { consumedHours: 3, remainingHours: 0 } }],
    })
  })

  it('requires confirmation before removing a package with an empty-task future assignment', async () => {
    const context = fixture([pack(1, 10)], [], [])
    context.taskAssignments.push(Object.assign(new SupportTaskAssignment(), { projectId: 10, bitrixTaskId: '100', packageId: 1 }))
    expect(await context.service.preview(1, { operation: 'delete' })).toMatchObject({ requiresConfirmation: true, movedHours: 0 })
    await expect(context.service.assertPreview(1, { operation: 'delete' })).rejects.toBeInstanceOf(ConflictException)
  })

  it('invalidates a preview after report allocations or a future task destination change', async () => {
    const context = fixture()
    const request = { operation: 'update' as const, changes: { comment: 'Note' } }
    const before = await context.service.preview(1, request)
    context.assignments.push(Object.assign(new SupportHoursAssignment(), { projectId: 10, bitrixReportId: '1', allocations: [] }))
    await expect(context.service.assertPreview(1, request, before.fingerprint)).rejects.toBeInstanceOf(ConflictException)
    const next = await context.service.preview(1, request)
    context.taskAssignments.push(Object.assign(new SupportTaskAssignment(), { projectId: 10, bitrixTaskId: '100', packageId: 2 }))
    await expect(context.service.assertPreview(1, request, next.fingerprint)).rejects.toBeInstanceOf(ConflictException)
  })
})
