import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common'
import { EntityTypeIds, FinancialProjectType, ProjectCodes } from '../constants/const'
import { ReportProject, ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { SupportHoursPackagesController } from './support-hours-packages.controller'
import { SupportHoursPackagesService } from './support-hours-packages.service'

const field = ProjectCodes.financialProjectType
type StoredProject = Pick<ReportProject, 'id' | 'bitrixProjectId' | 'title' | 'projectType'> & { projectGoal?: string; summaryFactHours?: number }
const stored = (id = 7, bitrixProjectId: string | null = '42', projectType = ReportProjectType.Support): StoredProject => ({
  id, bitrixProjectId, projectType, title: `Project ${bitrixProjectId}`, projectGoal: 'Keep planning data',
})
const source = (id: string, type: unknown = FinancialProjectType.Support) => ({ id, title: `Project ${id}`, [field]: type })

function fixture(initial: StoredProject[] = []) {
  let rows = structuredClone(initial)
  let nextId = Math.max(0, ...rows.map((row) => row.id)) + 1
  const live = new Map<string, Record<string, unknown>>()
  const matches = (row: StoredProject, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => row[key as keyof StoredProject] === value)
  const repository = {
    find: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(structuredClone(rows.filter((row) => matches(row, where))))),
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(structuredClone(rows.find((row) => matches(row, where)) ?? null))),
    create: jest.fn((value: Partial<StoredProject>) => value),
    save: jest.fn(async (value: StoredProject) => {
      await Promise.resolve()
      const saved = { ...value, id: value.id ?? nextId++ }
      const index = rows.findIndex((row) => row.id === saved.id)
      if (index === -1) rows.push(saved)
      else rows[index] = saved
      return structuredClone(saved)
    }),
    update: jest.fn(async (where: Record<string, unknown>, change: Partial<StoredProject>) => {
      await Promise.resolve()
      let affected = 0
      rows = rows.map((row) => {
        if (!matches(row, where)) return row
        affected += 1
        return { ...row, ...change }
      })
      return { affected }
    }),
  }
  const manager = { getRepository: jest.fn((entity: unknown) => {
    if (entity !== ReportProject) throw new Error('Catalogue sync must not access accounting or history tables')
    return repository
  }) }
  let transactionSnapshot: StoredProject[] = []
  const runner = {
    manager,
    isTransactionActive: false,
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string, _parameters: string[]) => {
      if (sql.includes('GET_LOCK')) return Promise.resolve([{ acquired: 1 }])
      if (sql.includes('RELEASE_LOCK')) return Promise.resolve([{ released: 1 }])
      return Promise.reject(new Error('Unexpected project lock query'))
    }),
    startTransaction: jest.fn(() => {
      transactionSnapshot = structuredClone(rows)
      runner.isTransactionActive = true
      return Promise.resolve()
    }),
    commitTransaction: jest.fn(() => { runner.isTransactionActive = false; return Promise.resolve() }),
    rollbackTransaction: jest.fn(() => {
      rows = transactionSnapshot
      runner.isTransactionActive = false
      return Promise.resolve()
    }),
  }
  const dataSource = { createQueryRunner: jest.fn(() => runner) }
  const bitrix = { listAllItems: jest.fn(async ({ entityTypeId, filter }: { entityTypeId: number; filter: Record<string, unknown> }) => {
    await Promise.resolve()
    if (entityTypeId !== EntityTypeIds.projects) throw new Error('Only project metadata may be requested')
    const ids = filter['@id'] as string[] | undefined
    if (ids) return structuredClone(ids.flatMap((id) => live.has(id) ? [live.get(id)] : []))
    return structuredClone([...live.values()].filter((item) => {
      const raw = item[field]
      return (Array.isArray(raw) ? raw : [raw]).map(String).includes(FinancialProjectType.Support)
    }))
  }) }
  const packagesRepository = { find: jest.fn((options: { where?: { project?: { projectType?: ReportProjectType } } }) => Promise.resolve(rows
    .filter((row) => !options.where?.project?.projectType || row.projectType === options.where.project.projectType)
    .map((row) => ({ id: row.id * 10, projectId: row.id, project: row, purchasedHours: 20, consumptions: [], purchaseDate: '2026-09-01' })))) }
  const service = new SupportHoursPackagesService(repository as never, packagesRepository as never, {} as never, {} as never, dataSource as never, bitrix as never)
  return { service, live, repository, packagesRepository, dataSource, runner, bitrix, rows: () => structuredClone(rows) }
}

// These tests drive the public service, including its cache and mutation queue.
describe('SupportHoursPackagesService project catalogue synchronization', () => {
  it('creates a support project once across repeated forced refreshes', async () => {
    const f = fixture()
    f.live.set('42', source('42'))
    await expect(f.service.syncSupportProjects(true)).resolves.toEqual({ created: 1, updated: 0 })
    await expect(f.service.syncSupportProjects(true)).resolves.toEqual({ created: 0, updated: 0 })
    expect(f.rows()).toEqual([{ id: 1, bitrixProjectId: '42', title: 'Project 42', projectType: ReportProjectType.Support }])
    expect(f.bitrix.listAllItems).toHaveBeenCalledTimes(2)
  })

  it('persists TP -> Waterfall immediately and never resurrects it on repeated refresh', async () => {
    const f = fixture([stored()])
    f.live.set('42', source('42'))
    await f.service.syncSupportProjects(true)
    f.live.set('42', source('42', FinancialProjectType.Waterfall))
    await expect(f.service.syncSupportProjects(true)).resolves.toEqual({ created: 0, updated: 1 })
    for (let pass = 0; pass < 3; pass += 1) {
      await f.service.syncSupportProjects(true)
      await expect(f.service.findSupportProjects()).resolves.toEqual([])
      await expect(f.service.findAll()).resolves.toEqual([])
    }
    expect(f.rows()).toEqual([{ ...stored(), projectType: ReportProjectType.Waterfall }])
    expect(f.repository.save).not.toHaveBeenCalled()
    expect(f.repository.update).toHaveBeenCalledWith({ id: 7 }, { title: 'Project 42', projectType: ReportProjectType.Waterfall })
  })

  it('restores the original local ID on Waterfall -> TP and retains unrelated fields', async () => {
    const f = fixture([stored(7, '42', ReportProjectType.Waterfall)])
    f.live.set('42', source('42'))
    await f.service.syncSupportProjects(true)
    expect(f.rows()).toEqual([stored()])
    expect(f.repository.save).not.toHaveBeenCalled()
    await expect(f.service.findSupportProjects()).resolves.toEqual([stored()])
  })

  it.each([null, '', [], '999'].map((type) => ({ type })))('reconciles an explicitly cleared/other type %p without deleting the project', async ({ type }) => {
    const f = fixture([stored()])
    f.live.set('42', source('42', type))
    await f.service.syncSupportProjects(true)
    expect(f.rows()).toEqual([{ ...stored(), projectType: ReportProjectType.None }])
  })

  it.each([410, ['410'], [410]].map((type) => ({ type })))('recognizes a support type represented as %p', async ({ type }) => {
    const f = fixture()
    f.live.set('42', source('42', type))
    await f.service.syncSupportProjects(true)
    expect(f.rows()[0].projectType).toBe(ReportProjectType.Support)
  })

  it('corrects all historical local rows linked to the same departed Bitrix project', async () => {
    const f = fixture([stored(), stored(8)])
    f.live.set('42', source('42', ['409']))
    await f.service.syncSupportProjects(true)
    expect(f.rows().map((row) => [row.id, row.projectType])).toEqual([[7, 'waterfall'], [8, 'waterfall']])
  })

  it('does not reclassify unrelated Waterfall or unlinked local projects', async () => {
    const original = [stored(1, null), stored(2, '90', ReportProjectType.Waterfall)]
    const f = fixture(original)
    await f.service.syncSupportProjects(true)
    expect(f.rows()).toEqual(original)
    expect(f.repository.update).not.toHaveBeenCalled()
  })

  it('rechecks every departure in bounded batches, including projects without report activity', async () => {
    const f = fixture(Array.from({ length: 51 }, (_, index) => stored(index + 1, String(index + 100))))
    for (let index = 0; index < 51; index += 1) f.live.set(String(index + 100), source(String(index + 100), '409'))
    await expect(f.service.syncSupportProjects(true)).resolves.toEqual({ created: 0, updated: 51 })
    const rechecks = f.bitrix.listAllItems.mock.calls.map(([request]) => request.filter['@id']).filter(Boolean) as string[][]
    expect(rechecks.map((ids) => ids.length)).toEqual([50, 1])
    expect(f.rows().every((row) => row.projectType === ReportProjectType.Waterfall)).toBe(true)
  })

  it('keeps the last good catalogue on a failed recheck and retries without caching the failure', async () => {
    const f = fixture([stored()])
    f.live.set('99', source('99'))
    f.live.set('42', source('42', '409'))
    f.bitrix.listAllItems.mockResolvedValueOnce([source('99')]).mockRejectedValueOnce(new Error('Bitrix unavailable'))
    await expect(f.service.syncSupportProjects()).rejects.toThrow('Bitrix unavailable')
    expect(f.rows()).toEqual([stored()])
    expect(f.dataSource.createQueryRunner).not.toHaveBeenCalled()
    await f.service.syncSupportProjects()
    expect(f.rows().find((row) => row.id === 7)?.projectType).toBe(ReportProjectType.Waterfall)
  })

  it.each([
    [],
    [source('99', '409')],
    [source('42', '409'), source('42', '409')],
    [{ id: '42', title: 'Missing type' }],
    [source('42', { unexpected: true })],
    [{ id: '42', title: 'Undefined type', [field]: undefined }],
  ].map((response) => ({ response })))('rejects an incomplete or invalid unfiltered recheck before writing: %p', async ({ response }) => {
    const f = fixture([stored()])
    f.bitrix.listAllItems.mockResolvedValueOnce([]).mockResolvedValueOnce(response)
    await expect(f.service.syncSupportProjects(true)).rejects.toBeInstanceOf(BadGatewayException)
    expect(f.rows()).toEqual([stored()])
    expect(f.dataSource.createQueryRunner).not.toHaveBeenCalled()
  })

  it.each([
    [{ id: 0, title: 'Invalid', [field]: '410' }],
    [source('42'), source('42')],
    [source('42', '409')],
    [{ id: '42', [field]: true }],
  ].map((response) => ({ response })))('rejects malformed discovery before saving: %p', async ({ response }) => {
    const f = fixture()
    f.bitrix.listAllItems.mockResolvedValueOnce(response)
    await expect(f.service.syncSupportProjects(true)).rejects.toBeInstanceOf(BadGatewayException)
    expect(f.rows()).toEqual([])
    expect(f.dataSource.createQueryRunner).not.toHaveBeenCalled()
  })

  it('rolls back catalogue writes when persistence fails', async () => {
    const original = [stored(), stored(8, '43')]
    const f = fixture(original)
    f.live.set('42', source('42', '409'))
    f.live.set('43', source('43', '409'))
    const update = f.repository.update.getMockImplementation()!
    f.repository.update.mockImplementationOnce(update).mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(f.service.syncSupportProjects(true)).rejects.toThrow('Database unavailable')
    expect(f.rows()).toEqual(original)
  })

  it('re-reads a project inserted by Work Tracker while catalogue synchronization waits for its lock', async () => {
    const f = fixture()
    f.live.set('42', source('42'))
    const query = f.runner.query.getMockImplementation()!
    f.runner.query.mockImplementationOnce(async (sql, parameters) => {
      expect(parameters).toEqual(['work-tracker:bitrix-project:42'])
      expect(f.runner.startTransaction).not.toHaveBeenCalled()
      await f.repository.save(stored(9, '42'))
      return query(sql, parameters)
    })
    await expect(f.service.syncSupportProjects(true)).resolves.toEqual({ created: 0, updated: 0 })
    expect(f.rows()).toEqual([stored(9, '42')])
    expect(f.repository.save).toHaveBeenCalledTimes(1)
    expect(f.runner.startTransaction).toHaveBeenCalledWith('READ COMMITTED')
  })

  it('takes every catalogue lock in a stable order before opening the transaction', async () => {
    const f = fixture()
    f.live.set('12', source('12'))
    f.live.set('2', source('2'))
    await f.service.syncSupportProjects(true)
    const acquired = f.runner.query.mock.calls.filter(([sql]) => sql.includes('GET_LOCK')).map(([, parameters]) => parameters[0])
    const released = f.runner.query.mock.calls.filter(([sql]) => sql.includes('RELEASE_LOCK')).map(([, parameters]) => parameters[0])
    expect(acquired).toEqual(['work-tracker:bitrix-project:2', 'work-tracker:bitrix-project:12'])
    expect(released).toEqual([...acquired].reverse())
    expect(f.runner.startTransaction.mock.invocationCallOrder[0]).toBeGreaterThan(f.runner.query.mock.invocationCallOrder[1])
    expect(f.runner.commitTransaction.mock.invocationCallOrder[0]).toBeLessThan(f.runner.query.mock.invocationCallOrder[2])
  })

  it('releases already acquired locks without any writes when another writer holds the next lock', async () => {
    const f = fixture()
    f.live.set('2', source('2'))
    f.live.set('12', source('12'))
    f.runner.query.mockResolvedValueOnce([{ acquired: 1 }]).mockResolvedValueOnce([{ acquired: 0 }])
    await expect(f.service.syncSupportProjects(true)).rejects.toBeInstanceOf(ConflictException)
    expect(f.runner.startTransaction).not.toHaveBeenCalled()
    expect(f.repository.save).not.toHaveBeenCalled()
    expect(f.runner.query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?) AS released', ['work-tracker:bitrix-project:2'])
    expect(f.runner.release).toHaveBeenCalled()
  })

  it('re-reads under the shared lock when a report import discovers a project concurrently with Work Tracker creation', async () => {
    const f = fixture()
    const query = f.runner.query.getMockImplementation()!
    f.runner.query.mockImplementationOnce(async (sql, parameters) => {
      expect(parameters).toEqual(['work-tracker:bitrix-project:42'])
      expect(f.runner.startTransaction).not.toHaveBeenCalled()
      await f.repository.save(stored(9, '42'))
      return query(sql, parameters)
    })
    const upsert = f.service as unknown as { upsertSupportProject(project: ReturnType<typeof source>): Promise<StoredProject> }
    await expect(upsert.upsertSupportProject(source('42'))).resolves.toMatchObject({ id: 9 })
    expect(f.rows()).toEqual([stored(9, '42')])
    expect(f.repository.save).toHaveBeenCalledTimes(1)
    expect(f.runner.startTransaction).toHaveBeenCalledWith('READ COMMITTED')
  })
  it('does not overwrite accounting changes made after a report importer read the project', async () => {
    const f = fixture([{ ...stored(7, '42'), summaryFactHours: 3 }])
    const findOne = f.repository.findOne.getMockImplementation()!
    f.repository.findOne.mockImplementationOnce(findOne).mockImplementationOnce(async (request) => {
      const snapshot = await findOne(request)
      await f.repository.update({ id: 7 }, { summaryFactHours: 99 })
      return snapshot
    })
    const upsert = f.service as unknown as { upsertSupportProject(project: ReturnType<typeof source>): Promise<StoredProject> }
    await expect(upsert.upsertSupportProject({ ...source('42'), title: 'Updated title' })).resolves.toMatchObject({ id: 7, title: 'Updated title' })
    expect(f.rows()).toEqual([{ ...stored(7, '42'), title: 'Updated title', summaryFactHours: 99 }])
    expect(f.repository.save).not.toHaveBeenCalled()
    expect(f.repository.update).toHaveBeenCalledWith({ id: 7 }, { title: 'Updated title', projectType: ReportProjectType.Support })
  })
  it('coalesces concurrent refresh requests but does not suppress the next explicit refresh', async () => {
    const f = fixture()
    f.live.set('42', source('42'))
    await Promise.all([f.service.syncSupportProjects(true), f.service.syncSupportProjects(true), f.service.syncSupportProjects(true)])
    expect(f.bitrix.listAllItems).toHaveBeenCalledTimes(1)
    await f.service.syncSupportProjects()
    expect(f.bitrix.listAllItems).toHaveBeenCalledTimes(1)
    await f.service.syncSupportProjects(true)
    expect(f.bitrix.listAllItems).toHaveBeenCalledTimes(2)
  })

  it('makes cached callers await a running forced refresh rather than returning stale success', async () => {
    const f = fixture([stored()])
    f.live.set('42', source('42'))
    await f.service.syncSupportProjects()
    f.live.set('42', source('42', '409'))
    const forced = f.service.syncSupportProjects(true)
    const cached = f.service.syncSupportProjects()
    await expect(forced).resolves.toEqual({ created: 0, updated: 1 })
    await expect(cached).resolves.toEqual({ created: 0, updated: 1 })
  })

  it('does not return cached tasks after the stored project type has changed', async () => {
    const f = fixture([stored(7, '42', ReportProjectType.Waterfall)])
    const cache = (f.service as unknown as { supportProjectTasksCache: Map<number, { expiresAt: number; tasks: unknown[] }> }).supportProjectTasksCache
    cache.set(7, { expiresAt: Date.now() + 300000, tasks: [{ id: '1', title: 'Stale' }] })
    await expect(f.service.findSupportProjectTasks(7)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('filters package groups by stored support type at the database query', async () => {
    const f = fixture([stored(), stored(8, '43', ReportProjectType.Waterfall)])
    const groups = await f.service.findAll()
    expect(groups.map((group) => group.project.id)).toEqual([7])
    expect(f.packagesRepository.find).toHaveBeenCalledWith(expect.objectContaining({ where: { project: { projectType: ReportProjectType.Support } } }))
  })

  it('always forces live project synchronization from the explicit HTTP refresh action', async () => {
    const service = { syncSupportProjects: jest.fn().mockResolvedValue({ created: 0, updated: 0 }) }
    const controller = new SupportHoursPackagesController(service as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    await controller.syncSupportProjects()
    expect(service.syncSupportProjects).toHaveBeenCalledWith(true)
  })
})
