import { BadGatewayException } from '@nestjs/common'
import { DailyReportCodes, EntityTypeIds, TaskCodes } from '../constants/const'
import { ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursAssignment } from './entities/support-hours-assignment.entity'
import { SupportTaskAssignment } from './entities/support-task-assignment.entity'
import { SupportHoursTransfer } from './entities/support-hours-transfer.entity'
import { SupportHoursPackagesService } from './support-hours-packages.service'

const project = { id: 1, bitrixProjectId: '101', title: 'Support project', projectType: ReportProjectType.Support }
const liveReport = (id: number, hours: number, overrides: Record<string, unknown> = {}) => ({
  id, title: `Report ${id}`, createdTime: '2025-01-01T10:00:00Z', begindate: '2025-01-01T10:00:00Z',
  [DailyReportCodes.parentproject]: '101', [DailyReportCodes.timeSpent]: hours,
  [DailyReportCodes.includeInPackage]: 'Y', [DailyReportCodes.title]: `Work ${id}`, ...overrides,
})
const cachedReport = (id: number, hours: number): SupportHoursReport => Object.assign(new SupportHoursReport(), {
  id, bitrixReportId: String(id), projectId: 1, hours, reportDate: new Date('2025-01-01T10:00:00Z'),
  lastActivityAt: new Date('2025-01-01T10:00:00Z'),
})
const task = (id: number, sourceProjectId = '101') => ({ id, title: `Task ${id}`, stageId: 'NEW', [TaskCodes.parentproject]: sourceProjectId })

function fixture(options: { packages?: number[]; reports?: SupportHoursReport[] } = {}) {
  let reports = structuredClone(options.reports ?? [])
  let consumptions: { reportId: number; packageId: number; hours: number }[] = []
  const packages = (options.packages ?? [10]).map((hours, index) => ({
    id: index + 1, projectId: 1, purchasedHours: hours, purchaseDate: `2025-01-0${index + 1}`,
  }))
  let sourceReports: Record<string, unknown>[] = []
  let sourceTasks: Record<string, unknown>[] = []
  let otherTasks: Record<string, unknown>[] = []
  const repo = {
    create: jest.fn((value) => Object.assign(new SupportHoursReport(), value)),
    merge: jest.fn((entity, source) => Object.assign(entity, Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)))),
    find: jest.fn(({ where }) => Promise.resolve(structuredClone(reports.filter((report) =>
      (where.projectId === undefined || report.projectId === where.projectId) &&
      (where.bitrixReportId === undefined || where.bitrixReportId.value.includes(report.bitrixReportId)),
    ).sort((first, second) => first.reportDate.getTime() - second.reportDate.getTime() || first.id - second.id)))),
    save: jest.fn((value) => {
      const index = reports.findIndex((item) => item.id === value.id)
      const saved = { ...value, id: index < 0 ? Math.max(0, ...reports.map((item) => item.id)) + 1 : reports[index].id }
      if (index < 0) reports.push(saved)
      else reports[index] = saved
      return Promise.resolve(saved)
    }),
    remove: jest.fn((value) => {
      reports = reports.filter((item) => item.id !== value.id)
      consumptions = consumptions.filter((item) => item.reportId !== value.id)
      return Promise.resolve(value)
    }),
  }
  const packageRepo = { find: jest.fn(({ relations }) => Promise.resolve(packages.map((item) => ({
    ...item,
    ...(relations ? { consumptions: consumptions.filter((row) => row.packageId === item.id).map((row) => ({ ...row, report: reports.find((report) => report.id === row.reportId) })) } : {}),
  })))) }
  const consumptionRepo = {
    create: jest.fn((value) => value),
    delete: jest.fn(({ packageId }) => { consumptions = consumptions.filter((row) => !packageId.value.includes(row.packageId)); return Promise.resolve() }),
    save: jest.fn((rows) => { consumptions.push(...rows); return Promise.resolve(rows) }),
  }
  const manager = { getRepository(entity: unknown) {
    if (entity === SupportHoursReport) return repo
    if (entity === SupportHoursPackage) return packageRepo
    if (entity === SupportHoursConsumption) return consumptionRepo
    if (entity === SupportHoursAssignment || entity === SupportTaskAssignment) return { find: jest.fn().mockResolvedValue([]) }
    if (entity === SupportHoursTransfer) return { findOne: jest.fn().mockResolvedValue(null) }
    throw new Error('Unexpected repository')
  } }
  let insideTransaction = false
  const source = { getRepository: manager.getRepository, transaction: jest.fn(async (operation) => {
    const snapshot = structuredClone({ reports, consumptions })
    insideTransaction = true
    try { return await operation(manager) }
    catch (error) { reports = snapshot.reports; consumptions = snapshot.consumptions; throw error }
    finally { insideTransaction = false }
  }) }
  const bitrix = {
    getItem: jest.fn(() => { expect(insideTransaction).toBe(false); return Promise.resolve({ id: 101, title: project.title, ufCrm20_1781683772: '410' }) }),
    listAllItems: jest.fn((params) => {
      expect(insideTransaction).toBe(false)
      if (params.entityTypeId === EntityTypeIds.reports) {
        return Promise.resolve(params.filter['@id'] ? sourceReports.filter((report) => params.filter['@id'].includes(String(report.id))) : sourceReports)
      }
      return Promise.resolve(params.filter['@id'] ? otherTasks.filter((task) => params.filter['@id'].includes(String(task.id))) : sourceTasks)
    }),
    getUsersByIds: jest.fn().mockResolvedValue([{ id: '12', title: 'Analyst' }]),
    getCompany: jest.fn().mockResolvedValue({ TITLE: 'Company' }),
    getListElementTitle: jest.fn().mockResolvedValue('Development'),
  }
  const projectRepo = { findOne: jest.fn().mockResolvedValue(project) }
  const service = new SupportHoursPackagesService(projectRepo as never, packageRepo as never, repo as never, consumptionRepo as never, source as never, bitrix as never)
  return { service, repo, bitrix, source, consumptionRepo,
    setReports: (values: Record<string, unknown>[]) => { sourceReports = values },
    setTasks: (values: Record<string, unknown>[]) => { sourceTasks = values },
    setOtherTasks: (values: Record<string, unknown>[]) => { otherTasks = values },
    state: () => ({ reports, consumptions }),
  }
}

describe('Support project analyst workspace', () => {
  it('imports all historical project reports and distinguishes no packages from excluded work', async () => {
    const f = fixture({ packages: [] })
    f.setReports([liveReport(1, 5), liveReport(2, 3, { [DailyReportCodes.includeInPackage]: 'N' })])
    f.setTasks([task(10), task(11)])
    const result = await f.service.getProjectWorkspace(1)
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({
      entityTypeId: EntityTypeIds.reports, filter: { [DailyReportCodes.parentproject]: 101 },
    }))
    expect(result.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', hours: 5, allocations: [], allocatedHours: 0, unallocatedHours: 5, date: '2025-01-01' }),
      expect.objectContaining({ id: '2', hours: 3, includeInPackage: false, allocations: [], unallocatedHours: 3 }),
    ]))
    expect(result.tasks.map((item) => item.id)).toEqual(['10', '11'])
    expect(result.packageGroup).toMatchObject({ purchasedHours: 0, consumedHours: 0, remainingHours: 0, packages: [] })
    expect(f.state().reports.map((report) => report.bitrixReportId)).toEqual(['1'])
  })

  it('preserves report splits and allocates overflow to the last package without reporting it twice', async () => {
    const f = fixture({ packages: [3, 5] })
    f.setReports([liveReport(1, 4), liveReport(2, 6, { begindate: '2025-01-02T10:00:00Z' })])
    const result = await f.service.getProjectWorkspace(1)
    expect(result.reports.find((report) => report.id === '1')).toMatchObject({
      allocations: [{ purchaseId: 1, purchaseDate: '2025-01-01', hours: 3 }, { purchaseId: 2, purchaseDate: '2025-01-02', hours: 1 }], allocatedHours: 4, unallocatedHours: 0,
    })
    expect(result.reports.find((report) => report.id === '2')).toMatchObject({ allocatedHours: 6, unallocatedHours: 0 })
    expect(result.packageGroup).toMatchObject({ purchasedHours: 8, consumedHours: 10, remainingHours: -2, state: 'overdue' })
    expect(result.packageGroup.packages.map((item) => item.remainingHours)).toEqual([0, -2])
  })

  it('removes deleted and unchecked cached reports, then recalculates once using the full current history', async () => {
    const f = fixture({ reports: [cachedReport(1, 80), cachedReport(2, 3)] })
    f.setReports([liveReport(2, 3, { [DailyReportCodes.includeInPackage]: 'N' }), liveReport(3, 2)])
    const result = await f.service.getProjectWorkspace(1)
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({ filter: { '@id': ['1'] } }))
    expect(f.state().reports.map((report) => report.bitrixReportId)).toEqual(['3'])
    expect(result.packageGroup).toMatchObject({ consumedHours: 2, remainingHours: 8 })
    expect(result.reports.map((report) => report.id)).toEqual(['3', '2'])
    expect(f.consumptionRepo.delete).toHaveBeenCalledTimes(1)
  })

  it('retains foreign and deleted task references without making them current project tasks', async () => {
    const f = fixture()
    f.setReports([liveReport(1, 2, { [DailyReportCodes.parentId]: 21 }), liveReport(2, 1, { [DailyReportCodes.parentId]: 22 })])
    f.setTasks([task(10)])
    f.setOtherTasks([task(21, '202')])
    const result = await f.service.getProjectWorkspace(1)
    expect(result.tasks.map((item) => item.id)).toEqual(['10'])
    expect(result.reports).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: '21', taskTitle: 'Task 21' }),
      expect.objectContaining({ taskId: '22', taskTitle: null }),
    ]))
  })

  it('fetches repeated user, company, activity and foreign task metadata only once', async () => {
    const f = fixture()
    const fields = { assignedById: 12, [DailyReportCodes.company]: 7, [DailyReportCodes.activityType]: 8, [DailyReportCodes.parentId]: 21 }
    f.setReports([liveReport(1, 2, fields), liveReport(2, 3, fields)])
    f.setOtherTasks([task(21, '202')])
    const result = await f.service.getProjectWorkspace(1)
    expect(f.bitrix.getUsersByIds).toHaveBeenCalledTimes(1)
    expect(f.bitrix.getCompany).toHaveBeenCalledTimes(1)
    expect(f.bitrix.getListElementTitle).toHaveBeenCalledTimes(1)
    expect(result.reports.every((report) => report.responsibleName === 'Analyst')).toBe(true)
  })

  it('counts reports attached to a task even when excluded from package billing', async () => {
    const f = fixture()
    f.setReports([liveReport(1, 2, { [DailyReportCodes.includeInPackage]: 'N', [DailyReportCodes.parentId]: 10 })])
    f.setTasks([task(10)])
    const result = await f.service.getProjectWorkspace(1)
    expect(result.reports[0]).toMatchObject({ taskId: '10', includeInPackage: false, unallocatedHours: 2 })
    expect(result.packageGroup.consumedHours).toBe(0)
  })

  it.each([
    { id: 'bad' }, { [DailyReportCodes.timeSpent]: 'many' }, { [DailyReportCodes.timeSpent]: -3 },
    { [DailyReportCodes.parentproject]: '202' }, { begindate: 'bad-date' }, { [DailyReportCodes.includeInPackage]: 'maybe' },
  ])('rejects malformed source report %p before changing cached billing', async (overrides) => {
    const f = fixture({ reports: [cachedReport(1, 80)] })
    f.setReports([liveReport(1, 2, overrides)])
    await expect(f.service.getProjectWorkspace(1)).rejects.toBeInstanceOf(BadGatewayException)
    expect(f.source.transaction).not.toHaveBeenCalled()
    expect(f.state().reports[0].hours).toBe(80)
  })

  it('fails closed on duplicate records and upstream page errors', async () => {
    const f = fixture({ reports: [cachedReport(1, 80)] })
    f.setReports([liveReport(1, 2), liveReport(1, 2)])
    await expect(f.service.getProjectWorkspace(1)).rejects.toBeInstanceOf(BadGatewayException)
    f.bitrix.listAllItems.mockRejectedValueOnce(new BadGatewayException('Incomplete items list'))
    await expect(f.service.getProjectWorkspace(1)).rejects.toThrow('Incomplete items list')
    expect(f.source.transaction).not.toHaveBeenCalled()
  })

  it('does not erase an item that reappeared in the project while reading pages', async () => {
    const f = fixture({ reports: [cachedReport(1, 80)] })
    f.bitrix.listAllItems.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([liveReport(1, 2)])
    await expect(f.service.getProjectWorkspace(1)).rejects.toThrow('изменились во время загрузки')
    expect(f.source.transaction).not.toHaveBeenCalled()
  })

  it('rolls back report replacement together with a failed allocation write', async () => {
    const f = fixture({ reports: [cachedReport(1, 80)] })
    f.setReports([liveReport(1, 2)])
    f.consumptionRepo.save.mockRejectedValueOnce(new Error('Database failed'))
    await expect(f.service.getProjectWorkspace(1)).rejects.toThrow('Database failed')
    expect(f.state().reports[0].hours).toBe(80)
  })
})
