import { BadGatewayException, BadRequestException, UnauthorizedException } from '@nestjs/common'
import { DailyReportCodes, EntityTypeIds } from '../constants/const'
import { ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursAssignment } from './entities/support-hours-assignment.entity'
import { SupportTaskAssignment } from './entities/support-task-assignment.entity'
import { SupportHoursTransfer } from './entities/support-hours-transfer.entity'
import { SupportHoursPackagesService } from './support-hours-packages.service'

const SUPPORT_FLAG = 'ufCrm11_1776177558677'
const token = 'support-report-test-token'
const reportId = '80'
const oldDate = new Date('2025-01-01T00:00:00Z')
const cachedReport = (): SupportHoursReport => ({
  id: 1, bitrixReportId: reportId, projectId: 1, hours: 80,
  reportDate: oldDate, lastActivityAt: oldDate, createdAt: oldDate, updatedAt: oldDate,
}) as SupportHoursReport
const liveReport = (overrides: Record<string, unknown> = {}) => ({
  id: reportId, title: 'Report', begindate: oldDate.toISOString(), createdTime: oldDate.toISOString(),
  [SUPPORT_FLAG]: 'Y', [DailyReportCodes.timeSpent]: 7,
  [DailyReportCodes.parentproject]: '101', ...overrides,
})
const webhook = (event = 'ONCRMDYNAMICITEMUPDATE', fields: Record<string, unknown> = {}) => ({
  event, auth: { application_token: token },
  data: { FIELDS: { ENTITY_TYPE_ID: EntityTypeIds.reports, ID: reportId, ...fields } },
})

function fixture(initialReports = [cachedReport()]) {
  let reports = structuredClone(initialReports)
  let consumptions = initialReports.map((report) => ({ reportId: report.id, packageId: report.projectId, hours: report.hours }))
  const packages = [1, 2].map((id) => ({ id, projectId: id, purchasedHours: 100, purchaseDate: '2025-01-01' }))
  const projects = [1, 2].map((id) => ({ id, bitrixProjectId: String(100 + id), title: `Project ${id}`, projectType: ReportProjectType.Support }))
  const reportsRepository = {
    create: jest.fn((value) => Object.assign(new SupportHoursReport(), value)),
    merge: jest.fn((entity, source) => {
      // TypeORM copies only defined column/relation values from its source entity.
      for (const [key, value] of Object.entries(source)) {
        if (value !== undefined) entity[key] = value
      }
      return entity
    }),
    find: jest.fn((options?: { where?: { projectId: number } }) => Promise.resolve(structuredClone(reports.filter((report) => !options?.where || report.projectId === options.where.projectId)))),
    findOne: jest.fn(({ where }) => Promise.resolve(structuredClone(reports.find((report) => report.bitrixReportId === where.bitrixReportId) ?? null))),
    save: jest.fn((value) => {
      const index = reports.findIndex((report) => report.id === value.id)
      if (index < 0 && reports.some((report) => report.bitrixReportId === value.bitrixReportId)) {
        throw new Error(`Duplicate entry ${value.bitrixReportId} for unique Bitrix report ID`)
      }
      const saved = { ...value, id: index < 0 ? Math.max(0, ...reports.map((report) => report.id)) + 1 : reports[index].id }
      if (index < 0) reports.push(saved)
      else reports[index] = saved
      return Promise.resolve(saved)
    }),
    remove: jest.fn((value) => {
      reports = reports.filter((report) => report.id !== value.id)
      consumptions = consumptions.filter((row) => row.reportId !== value.id)
      return Promise.resolve(value)
    }),
  }
  const packagesRepository = { find: jest.fn(({ where }) => Promise.resolve(packages.filter((item) => item.projectId === where.projectId))) }
  const consumptionsRepository = {
    create: jest.fn((value) => value),
    delete: jest.fn(({ packageId }) => { consumptions = consumptions.filter((row) => !packageId.value.includes(row.packageId)); return Promise.resolve() }),
    save: jest.fn((rows) => { consumptions.push(...rows); return Promise.resolve(rows) }),
  }
  const projectsRepository = {
    findOne: jest.fn(({ where }) => Promise.resolve(projects.find((project) => project.bitrixProjectId === where.bitrixProjectId) ?? null)),
    create: jest.fn((value) => value), save: jest.fn((value) => Promise.resolve(value)),
  }
  const manager = {
    getRepository(entity: unknown) {
      if (entity === SupportHoursReport) return reportsRepository
      if (entity === SupportHoursPackage) return packagesRepository
      if (entity === SupportHoursConsumption) return consumptionsRepository
      if (entity === SupportHoursAssignment || entity === SupportTaskAssignment) return { find: jest.fn().mockResolvedValue([]) }
      if (entity === SupportHoursTransfer) return { findOne: jest.fn().mockResolvedValue(null) }
      throw new Error('Unexpected repository')
    },
  }
  const dataSource = {
    getRepository: manager.getRepository,
    transaction: jest.fn(async (operation) => {
      const snapshot = structuredClone({ reports, consumptions })
      try { return await operation(manager) }
      catch (error) { reports = snapshot.reports; consumptions = snapshot.consumptions; throw error }
    }),
  }
  const bitrix = {
    listAllItems: jest.fn().mockResolvedValue([]),
    getItem: jest.fn(({ entityTypeId, id }) => Promise.resolve(entityTypeId === EntityTypeIds.reports
      ? liveReport()
      : { id, title: `Project ${id - 100}`, ufCrm20_1781683772: '410' })),
    getUsersByIds: jest.fn().mockResolvedValue([]),
    getCompany: jest.fn().mockResolvedValue(null),
    getListElementTitle: jest.fn().mockResolvedValue(null),
  }
  const service = new SupportHoursPackagesService(projectsRepository as never, packagesRepository as never, reportsRepository as never, consumptionsRepository as never, dataSource as never, bitrix as never)
  return { service, reportsRepository, consumptionsRepository, dataSource, bitrix, state: () => ({ reports, consumptions }) }
}

describe('Support hours authoritative report reconciliation', () => {
  const priorSecret = process.env.SUPPORT_HOURS_WEBHOOK_SECRET
  beforeEach(() => { process.env.SUPPORT_HOURS_WEBHOOK_SECRET = token })
  afterAll(() => {
    if (priorSecret === undefined) delete process.env.SUPPORT_HOURS_WEBHOOK_SECRET
    else process.env.SUPPORT_HOURS_WEBHOOK_SECRET = priorSecret
  })

  it('updates a real entity with undefined declared fields without erasing its existing primary key', async () => {
    const fresh = new SupportHoursReport()
    expect(Object.hasOwn(fresh, 'id')).toBe(true)
    expect(fresh.id).toBeUndefined()
    expect(Object.hasOwn(fresh, 'createdAt')).toBe(true)
    const f = fixture()
    await f.service.processReportWebhook(webhook())
    await f.service.processReportWebhook(webhook())
    expect(f.reportsRepository.save).toHaveBeenLastCalledWith(expect.objectContaining({
      id: 1, bitrixReportId: reportId, hours: 7, createdAt: oldDate, updatedAt: oldDate,
    }))
    expect(f.state().reports).toHaveLength(1)
    expect(f.state().reports[0].id).toBe(1)
    expect(f.state().consumptions).toEqual([{ reportId: 1, packageId: 1, hours: 7 }])
  })

  it('inserts a previously unseen report with a generated primary key, then updates that same row', async () => {
    const f = fixture([])
    await f.service.processReportWebhook(webhook())
    await f.service.processReportWebhook(webhook())
    expect(f.state().reports).toHaveLength(1)
    expect(f.state().reports[0]).toMatchObject({ id: 1, bitrixReportId: reportId, hours: 7 })
    expect(f.state().consumptions).toEqual([{ reportId: 1, packageId: 1, hours: 7 }])
  })

  it('removes an old deleted 80-hour report even outside the discovery window', async () => {
    const f = fixture()
    await f.service.sync()
    expect(f.reportsRepository.find).toHaveBeenCalledWith()
    expect(f.bitrix.listAllItems).toHaveBeenLastCalledWith(expect.objectContaining({ filter: { '@id': [reportId] } }))
    expect(f.state()).toEqual({ reports: [], consumptions: [] })
  })

  it('rechecks cached reports in bounded batches, including the last partial batch', async () => {
    const cached = Array.from({ length: 51 }, (_, index) => ({ ...cachedReport(), id: index + 1, bitrixReportId: String(80 + index) }))
    const f = fixture(cached)
    await f.service.sync()
    const batches = f.bitrix.listAllItems.mock.calls.slice(1).map((call) => call[0].filter['@id'])
    expect(batches.map((batch) => batch.length)).toEqual([50, 1])
    expect(batches.flat()).toEqual(cached.map((report) => report.bitrixReportId))
    expect(f.state()).toEqual({ reports: [], consumptions: [] })
  })

  it('updates an old report that is still present in the unfiltered recheck', async () => {
    const f = fixture()
    f.bitrix.listAllItems.mockResolvedValueOnce([]).mockResolvedValueOnce([liveReport()])
    await f.service.sync()
    expect(f.state().reports[0].hours).toBe(7)
    expect(f.state().consumptions).toEqual([{ reportId: 1, packageId: 1, hours: 7 }])
  })

  it('reads shared metadata once per sync while keeping each report and the next sync fresh', async () => {
    const initial = [80, 81, 82].map((id, index) => ({ ...cachedReport(), id: index + 1, bitrixReportId: String(id) }))
    const f = fixture(initial)
    let version = 1
    let excludedId: string | null = null
    f.bitrix.listAllItems.mockImplementation(({ entityTypeId, filter }) => {
      if (entityTypeId === EntityTypeIds.tasks) return Promise.resolve([{ id: 1002, title: `Task ${version}` }])
      if (!filter['@id']) return Promise.resolve([])
      return Promise.resolve(initial.map((report) => liveReport({
        id: report.bitrixReportId, assignedById: 3,
        [DailyReportCodes.parentId]: 1002, [DailyReportCodes.company]: 200,
        [DailyReportCodes.activityType]: 300, [DailyReportCodes.timeSpent]: 6 + version,
        [SUPPORT_FLAG]: report.bitrixReportId === excludedId ? 'N' : 'Y',
      })))
    })
    f.bitrix.getItem.mockImplementation(async ({ id }) => ({ id, title: `Project ${version}`, ufCrm20_1781683772: '410' }))
    f.bitrix.getUsersByIds.mockImplementation(async () => [{ id: '3', title: `Person ${version}` }])
    f.bitrix.getCompany.mockImplementation(async () => ({ TITLE: `Company ${version}` }))
    f.bitrix.getListElementTitle.mockImplementation(async () => `Activity ${version}`)

    await f.service.sync()
    expect(f.state().reports).toHaveLength(3)
    expect(f.state().reports.every((report) => report.hours === 7 && report.taskTitle === 'Task 1')).toBe(true)
    expect(f.state().consumptions.reduce((sum, row) => sum + row.hours, 0)).toBe(21)
    expect(f.bitrix.getItem).toHaveBeenCalledTimes(1)
    expect(f.bitrix.listAllItems.mock.calls.filter(([request]) => request.entityTypeId === EntityTypeIds.tasks)).toHaveLength(1)
    expect(f.bitrix.getUsersByIds).toHaveBeenCalledTimes(1)
    expect(f.bitrix.getCompany).toHaveBeenCalledTimes(1)
    expect(f.bitrix.getListElementTitle).toHaveBeenCalledTimes(1)

    version = 2
    excludedId = '82'
    await f.service.sync()
    expect(f.state().reports).toHaveLength(2)
    for (const report of f.state().reports) expect(report).toMatchObject({
      hours: 8, taskTitle: 'Task 2', responsibleName: 'Person 2',
      companyName: 'Company 2', activityTitle: 'Activity 2', projectTitle: 'Project 2',
    })
    expect(f.state().consumptions.reduce((sum, row) => sum + row.hours, 0)).toBe(16)
    expect(f.bitrix.getItem).toHaveBeenCalledTimes(2)
    expect(f.bitrix.listAllItems.mock.calls.filter(([request]) => request.entityTypeId === EntityTypeIds.tasks)).toHaveLength(2)
    expect(f.bitrix.getUsersByIds).toHaveBeenCalledTimes(2)
    expect(f.bitrix.getCompany).toHaveBeenCalledTimes(2)
    expect(f.bitrix.getListElementTitle).toHaveBeenCalledTimes(2)
  })

  it('does not retain a failed metadata request for a retry', async () => {
    const f = fixture()
    f.bitrix.listAllItems.mockImplementation(async ({ filter }) => filter['@id'] ? [liveReport()] : [])
    f.bitrix.getItem.mockRejectedValueOnce(new BadGatewayException('Project unavailable'))
    await expect(f.service.sync()).rejects.toThrow('Project unavailable')
    expect(f.state().reports[0].hours).toBe(80)
    await f.service.sync()
    expect(f.state().reports[0].hours).toBe(7)
    expect(f.bitrix.getItem).toHaveBeenCalledTimes(2)
  })

  it('rechecks project eligibility on every sync rather than caching it between requests', async () => {
    const f = fixture()
    f.bitrix.listAllItems.mockImplementation(async ({ filter }) => filter['@id'] ? [liveReport()] : [])
    await f.service.sync()
    expect(f.state().reports[0].hours).toBe(7)
    f.bitrix.getItem.mockResolvedValueOnce({ id: '101', title: 'Project 1', ufCrm20_1781683772: '409' } as never)
    await f.service.sync()
    expect(f.state()).toEqual({ reports: [], consumptions: [] })
    expect(f.bitrix.getItem).toHaveBeenCalledTimes(2)
  })

  it('retains an eligible report if its linked task has been deleted', async () => {
    const f = fixture()
    f.bitrix.getItem.mockResolvedValueOnce(liveReport({ [DailyReportCodes.parentId]: '1002' }) as never)
    await f.service.processReportWebhook(webhook())
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({ entityTypeId: EntityTypeIds.tasks, filter: { '@id': [1002] } }))
    expect(f.state().reports[0]).toMatchObject({ hours: 7, taskTitle: null })
    expect(f.state().consumptions).toEqual([{ reportId: 1, packageId: 1, hours: 7 }])
  })

  it('keeps old reports when their batch cannot be read', async () => {
    const f = fixture()
    f.bitrix.listAllItems.mockResolvedValueOnce([]).mockRejectedValueOnce(new BadGatewayException('Unavailable'))
    await expect(f.service.sync()).rejects.toThrow('Unavailable')
    expect(f.state().reports[0].hours).toBe(80)
    expect(f.state().consumptions[0].hours).toBe(80)
  })

  it('does not treat malformed returned report fields as evidence of deletion or ineligibility', async () => {
    const f = fixture()
    f.bitrix.listAllItems.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: reportId }])
    await expect(f.service.sync()).rejects.toThrow('invalid report recheck response')
    expect(f.reportsRepository.remove).not.toHaveBeenCalled()
  })

  it('removes a cached report when the display/support flag is unchecked', async () => {
    const f = fixture()
    f.bitrix.getItem.mockResolvedValueOnce(liveReport({ [SUPPORT_FLAG]: 'N' }) as never)
    await f.service.processReportWebhook(webhook())
    expect(f.state()).toEqual({ reports: [], consumptions: [] })
  })

  it('reallocates both the previous and new project after a report moves', async () => {
    const f = fixture()
    f.bitrix.getItem.mockResolvedValueOnce(liveReport({ [DailyReportCodes.parentproject]: '102' }) as never)
    await f.service.processReportWebhook(webhook())
    expect(f.state().reports[0]).toMatchObject({ projectId: 2, hours: 7 })
    expect(f.state().consumptions).toEqual([{ reportId: 1, packageId: 2, hours: 7 }])
  })

  it('processes deletion idempotently without fetching an already deleted report', async () => {
    const f = fixture()
    await f.service.processReportWebhook(webhook('ONCRMDYNAMICITEMDELETE'))
    await f.service.processReportWebhook(webhook('ONCRMDYNAMICITEMDELETE'))
    expect(f.bitrix.getItem).not.toHaveBeenCalled()
    expect(f.reportsRepository.remove).toHaveBeenCalledTimes(1)
    expect(f.state()).toEqual({ reports: [], consumptions: [] })
  })

  it('requires the webhook secret and an explicit reports entity for deletion', async () => {
    const f = fixture()
    await expect(f.service.processReportWebhook({ ...webhook('ONCRMDYNAMICITEMDELETE'), secret: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException)
    expect(await f.service.processReportWebhook(webhook('ONCRMDYNAMICITEMDELETE', { ENTITY_TYPE_ID: EntityTypeIds.tasks }))).toMatchObject({ processed: false })
    expect(await f.service.processReportWebhook(webhook('ONCRMDYNAMICITEMDELETE', { ENTITY_TYPE_ID: undefined }))).toMatchObject({ processed: false })
    expect(f.reportsRepository.remove).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5, true, '1abc', ''])('rejects invalid report ID %s', async (id) => {
    const f = fixture()
    await expect(f.service.processReportWebhook(webhook('ONCRMDYNAMICITEMDELETE', { ID: id }))).rejects.toBeInstanceOf(BadRequestException)
    expect(f.reportsRepository.remove).not.toHaveBeenCalled()
  })

  it('rolls back report edits together with allocations when allocation saving fails', async () => {
    const f = fixture()
    f.consumptionsRepository.save.mockRejectedValueOnce(new Error('Database write failed'))
    await expect(f.service.processReportWebhook(webhook())).rejects.toThrow('Database write failed')
    expect(f.state().reports[0].hours).toBe(80)
    expect(f.state().consumptions).toEqual([{ reportId: 1, packageId: 1, hours: 80 }])
  })

  it('finishes earlier report allocations if a later report fails, then recovers on retry', async () => {
    const second = { ...cachedReport(), id: 2, bitrixReportId: '81' }
    const f = fixture([cachedReport(), second])
    f.bitrix.listAllItems.mockResolvedValueOnce([]).mockResolvedValueOnce([liveReport(), liveReport({ id: '81', [DailyReportCodes.parentproject]: '102' })])
    f.bitrix.getItem.mockResolvedValueOnce({ id: 101, title: 'Project 1', ufCrm20_1781683772: '410' } as never).mockRejectedValueOnce(new BadGatewayException('Project unavailable'))
    await expect(f.service.sync()).rejects.toThrow('Project unavailable')
    expect(f.state().reports.map((report) => report.hours)).toEqual([7, 80])
    expect(f.state().consumptions.reduce((sum, row) => sum + row.hours, 0)).toBe(87)
    await f.service.processReportWebhook(webhook('ONCRMDYNAMICITEMDELETE', { ID: '81' }))
    expect(f.state().consumptions).toEqual([{ reportId: 1, packageId: 1, hours: 7 }])
  })

  it('serializes webhook changes after a running reconciliation', async () => {
    const f = fixture()
    let release: (reports: unknown[]) => void = () => undefined
    f.bitrix.listAllItems.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const sync = f.service.sync()
    await Promise.resolve()
    await Promise.resolve()
    const deletion = f.service.processReportWebhook(webhook('ONCRMDYNAMICITEMDELETE'))
    expect(f.dataSource.transaction).not.toHaveBeenCalled()
    release([])
    await Promise.all([sync, deletion])
    expect(f.state()).toEqual({ reports: [], consumptions: [] })
  })
})
