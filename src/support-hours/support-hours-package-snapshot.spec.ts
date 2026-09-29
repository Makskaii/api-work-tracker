import { BadGatewayException } from '@nestjs/common'
import { DailyReportCodes, EntityTypeIds, TaskCodes, TaskStageIds } from '../constants/const'
import { ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursPackagesService } from './support-hours-packages.service'

const FLAG = 'ufCrm11_1776177558677'
const now = new Date('2026-09-29T10:00:00Z')
const project = { id: 1, bitrixProjectId: '101', title: 'Support project', projectType: ReportProjectType.Support }
const report = (id: number, taskId = '1002', hours = 2, date = '2026-09-01T10:00:00Z'): SupportHoursReport => Object.assign(new SupportHoursReport(), {
  id, bitrixReportId: String(id), projectId: 1, bitrixTaskId: taskId, hours,
  taskTitle: `Cached task ${taskId}`, reportDate: new Date(date), lastActivityAt: new Date(date),
})
const liveReport = (id: number, taskId = '1002', hours = 2, date = '2025-01-01T10:00:00Z') => ({
  id, title: `Report ${id}`, begindate: date, createdTime: date,
  [DailyReportCodes.parentproject]: '101', [DailyReportCodes.parentId]: taskId,
  [DailyReportCodes.timeSpent]: hours, [FLAG]: 'Y',
})

function fixture() {
  let reports = [report(1, '1002', 4), report(2, '1002', 2, '2026-09-02T10:00:00Z')]
  let rows = [
    { reportId: 1, packageId: 1, hours: 3 },
    { reportId: 1, packageId: 2, hours: 1 },
    { reportId: 2, packageId: 2, hours: 2 },
  ]
  const packages = [
    { id: 1, projectId: 1, project, purchasedHours: 3, purchaseDate: '2025-01-01' },
    { id: 2, projectId: 1, project, purchasedHours: 10, purchaseDate: '2026-09-01' },
  ]
  const hydratedPackage = (id: number) => {
    const item = packages.find((item) => item.id === id)
    return item ? { ...item, consumptions: rows.filter((row) => row.packageId === id).map((row) => ({ ...row, report: reports.find((report) => report.id === row.reportId) })) } : null
  }
  const packageRepo = {
    findOne: jest.fn(({ where }) => Promise.resolve(hydratedPackage(where.id))),
    find: jest.fn(({ where }) => Promise.resolve(packages.filter((item) => item.projectId === where.projectId))),
  }
  const reportRepo = {
    create: jest.fn((values) => Object.assign(new SupportHoursReport(), values)),
    merge: jest.fn((entity, values) => Object.assign(entity, Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)))),
    findOne: jest.fn(({ where }) => Promise.resolve(reports.find((report) => report.bitrixReportId === where.bitrixReportId) ?? null)),
    find: jest.fn(({ where }) => Promise.resolve(reports
      .filter((report) => report.projectId === where.projectId && (!where.bitrixTaskId || where.bitrixTaskId.value.includes(report.bitrixTaskId)))
      .toSorted((first, second) => first.reportDate.getTime() - second.reportDate.getTime() || first.id - second.id)
      .map((report) => ({ ...report, consumptions: rows.filter((row) => row.reportId === report.id).map((row) => ({ ...row, package: packages.find((item) => item.id === row.packageId) })) })))),
    save: jest.fn((value) => {
      const index = reports.findIndex((report) => report.id === value.id)
      const entity = { ...value, id: index < 0 ? Math.max(0, ...reports.map((report) => report.id)) + 1 : reports[index].id }
      if (index < 0) reports.push(entity)
      else reports[index] = entity
      return Promise.resolve(entity)
    }),
  }
  const consumptionRepo = {
    create: jest.fn((value) => value),
    delete: jest.fn(({ packageId }) => { rows = rows.filter((row) => !packageId.value.includes(row.packageId)); return Promise.resolve() }),
    save: jest.fn((values) => { rows.push(...values); return Promise.resolve(values) }),
  }
  let activeTransactions = 0
  const manager = {
    getRepository(entity: unknown) {
      if (entity === SupportHoursPackage) return packageRepo
      if (entity === SupportHoursReport) return reportRepo
      if (entity === SupportHoursConsumption) return consumptionRepo
      throw new Error('Unexpected repository')
    },
  }
  const dataSource = { transaction: jest.fn(async (operation) => { activeTransactions += 1; try { return await operation(manager) } finally { activeTransactions -= 1 } }) }
  const projectRepo = { findOne: jest.fn(() => Promise.resolve(project)) }
  let history: ReturnType<typeof liveReport>[] = []
  let metadata = [{ id: '1002', title: 'Current task', stageId: TaskStageIds.testing as string, [TaskCodes.hours]: 30 as unknown }]
  const bitrix = {
    listAllItems: jest.fn((params) => {
      expect(activeTransactions).toBe(0)
      if (params.entityTypeId === EntityTypeIds.reports) {
        const ids = params.filter[`@${DailyReportCodes.parentId}`]
        return Promise.resolve(history.filter((report) => ids.includes(report[DailyReportCodes.parentId])))
      }
      if (params.select.includes(TaskCodes.hours)) return Promise.resolve(metadata.filter((task) => params.filter['@id'].includes(String(task.id))))
      return Promise.resolve([{ id: params.filter['@id'][0], title: 'Current task' }])
    }),
    getItem: jest.fn(() => { expect(activeTransactions).toBe(0); return Promise.resolve({ id: 101, title: project.title, ufCrm20_1781683772: '410' }) }),
  }
  const service = new SupportHoursPackagesService(projectRepo as never, packageRepo as never, reportRepo as never, consumptionRepo as never, dataSource as never, bitrix as never)
  const sync = jest.spyOn(service, 'sync').mockResolvedValue({ processedReports: 0, synchronizedAt: now.toISOString() })
  return {
    service, bitrix, reportRepo, sync,
    setHistory: (value: typeof history) => { history = value },
    setMetadata: (value: typeof metadata) => { metadata = value },
    setStored: (value: typeof reports, allocations: typeof rows) => { reports = value; rows = allocations },
  }
}

describe('Support package current task contexts', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(now) })
  afterEach(() => { jest.useRealTimers() })

  it('uses the numeric enabled value for delta discovery instead of the returned Y/N field format', async () => {
    const bitrix = { listAllItems: jest.fn().mockResolvedValue([]) }
    const service = new SupportHoursPackagesService({} as never, {} as never, { find: jest.fn().mockResolvedValue([]) } as never, {} as never, {} as never, bitrix as never)
    await service.sync()
    expect(bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({
      entityTypeId: EntityTypeIds.reports,
      filter: { '>=lastActivityTime': '2026-09-27T10:00:00.000Z', [FLAG]: 1 },
    }))
  })

  it('includes same-task reports from both packages with their allocations and current budget/status', async () => {
    const f = fixture()
    const snapshot = await f.service.getReportSnapshot(2)
    expect(snapshot.taskContexts).toHaveLength(1)
    expect(snapshot.taskContexts[0]).toMatchObject({ id: '1002', title: 'Current task', status: 'in_work', soldHours: 30 })
    expect(snapshot.taskContexts[0].reports.map((report) => report.hours)).toEqual([4, 2])
    expect(snapshot.taskContexts[0].reports[0].consumptions.map((row) => [row.packageId, row.hours])).toEqual([[1, 3], [2, 1]])
    expect(snapshot.consumptions.reduce((sum, row) => sum + row.hours, 0)).toBe(3)
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({ filter: { '@id': ['1002'] }, select: ['id', 'title', 'stageId', TaskCodes.hours] }))
  })

  it('discovers an uncached old eligible report outside the 48-hour window before the final allocation snapshot', async () => {
    const f = fixture()
    f.setHistory([liveReport(3, '1002', 1)])
    const snapshot = await f.service.getReportSnapshot(2)
    expect(snapshot.taskContexts[0].reports.map((report) => report.bitrixReportId)).toEqual(['3', '1', '2'])
    expect(snapshot.taskContexts[0].reports.reduce((sum, report) => sum + report.hours, 0)).toBe(7)
    expect(snapshot.consumptions.reduce((sum, row) => sum + row.hours, 0)).toBe(4)
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({
      entityTypeId: EntityTypeIds.reports,
      filter: { [FLAG]: 1, [DailyReportCodes.parentproject]: 101, [`@${DailyReportCodes.parentId}`]: ['1002'] },
    }))
  })

  it('discovers newly exposed task history after older reports redistribute package allocations', async () => {
    const f = fixture()
    f.setStored([report(1, '1002', 3, '2026-09-02T10:00:00Z'), report(2, '1003', 3)], [
      { reportId: 2, packageId: 1, hours: 3 }, { reportId: 1, packageId: 2, hours: 3 },
    ])
    f.setHistory([liveReport(3, '1002', 3)])
    f.setMetadata([
      { id: '1002', title: 'Task A', stageId: TaskStageIds.testing, [TaskCodes.hours]: 10 },
      { id: '1003', title: 'Task B', stageId: TaskStageIds.done, [TaskCodes.hours]: 10 },
    ])
    const snapshot = await f.service.getReportSnapshot(2)
    expect(snapshot.taskContexts.map((task) => task.id).sort()).toEqual(['1002', '1003'])
    const historyQueries = f.bitrix.listAllItems.mock.calls.filter(([query]) => query.entityTypeId === EntityTypeIds.reports)
    expect(historyQueries.map(([query]) => query.filter[`@${DailyReportCodes.parentId}`])).toEqual([['1002'], ['1003']])
    expect(snapshot.taskContexts.find((task) => task.id === '1003')?.status).toBe('completed')
  })

  it('does not seed unrelated, future-only, or standalone tasks from another package', async () => {
    const f = fixture()
    f.setStored([report(1, '1002'), report(2, '1003'), report(3, '1004', 2, '2026-10-01T10:00:00Z'), report(4, '')], [
      { reportId: 1, packageId: 2, hours: 2 }, { reportId: 2, packageId: 1, hours: 2 },
      { reportId: 3, packageId: 2, hours: 2 }, { reportId: 4, packageId: 2, hours: 2 },
    ])
    const snapshot = await f.service.getReportSnapshot(2)
    expect(snapshot.taskContexts.map((task) => task.id)).toEqual(['1002'])
    expect(f.bitrix.listAllItems.mock.calls.every(([query]) => !JSON.stringify(query.filter).includes('1003') && !JSON.stringify(query.filter).includes('1004'))).toBe(true)
  })

  it('keeps a missing task as unknown with cached title and without inventing a sold-hours value', async () => {
    const f = fixture()
    f.setMetadata([])
    const snapshot = await f.service.getReportSnapshot(2)
    expect(snapshot.taskContexts[0]).toMatchObject({ title: 'Cached task 1002', status: 'unknown', soldHours: null })
    expect(snapshot.taskContexts[0].reports).toHaveLength(2)
  })

  it.each([null, '', '   '])('keeps an unset task budget %s as null', async (value) => {
    const f = fixture()
    f.setMetadata([{ id: '1002', title: 'Task', stageId: TaskStageIds.done, [TaskCodes.hours]: value }])
    expect((await f.service.getReportSnapshot(2)).taskContexts[0]).toMatchObject({ status: 'completed', soldHours: null })
  })

  it.each(['DT1072_18:UC_JP9WR1', 'DT1072_18:FAIL'])('reports the known cancelled stage %s explicitly', async (stageId) => {
    const f = fixture()
    f.setMetadata([{ id: '1002', title: 'Task', stageId, [TaskCodes.hours]: 30 }])
    expect((await f.service.getReportSnapshot(2)).taskContexts[0].status).toBe('cancelled')
  })

  it('does not infer an in-work status for an unknown stage/category', async () => {
    const f = fixture()
    f.setMetadata([{ id: '1002', title: 'Task', stageId: 'DT1072_99:NEW', [TaskCodes.hours]: 30 }])
    expect((await f.service.getReportSnapshot(2)).taskContexts[0].status).toBe('unknown')
  })

  it.each(['bad', -1, undefined])('rejects malformed task budget %s', async (value) => {
    const f = fixture()
    f.setMetadata([{ id: '1002', title: 'Task', stageId: TaskStageIds.done, [TaskCodes.hours]: value }])
    await expect(f.service.getReportSnapshot(2)).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('fails before historical writes if the authoritative history request fails', async () => {
    const f = fixture()
    f.bitrix.listAllItems.mockRejectedValueOnce(new BadGatewayException('History unavailable'))
    await expect(f.service.getReportSnapshot(2)).rejects.toThrow('History unavailable')
    expect(f.reportRepo.save).not.toHaveBeenCalled()
  })
})
