import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common'
import type { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import type { SupportHoursPackage } from './entities/support-hours-package.entity'
import { buildSupportPackageReportData, SupportHoursPackageReportService } from './support-hours-package-report.service'
import { SupportHoursPackagesController } from './support-hours-packages.controller'
import { SupportHoursPackagesService } from './support-hours-packages.service'
import type { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursTransfer } from './entities/support-hours-transfer.entity'
import { SupportTaskAssignment } from './entities/support-task-assignment.entity'
import type { SupportHoursPackageReportSnapshot, SupportPackageTaskContext } from './support-hours-package-report.types'

const now = new Date('2026-09-29T08:00:00Z')
function consumption(id: number, hours: number, overrides: Record<string, unknown> = {}): SupportHoursConsumption {
  return {
    id, packageId: 10, reportId: id, hours,
    report: {
      id, bitrixReportId: String(id), hours: 80, reportDate: new Date('2026-09-01T10:00:00Z'),
      reportDescription: `Работа ${id}`, reportTitle: `Отчёт ${id}`,
      bitrixTaskId: '1002', taskTitle: 'Незавершённая задача', companyName: 'Клиент',
      ...overrides,
    },
  } as SupportHoursConsumption
}
function packageFixture(rows = [consumption(1, 2)]): SupportHoursPackage {
  return {
    id: 10, projectId: 1, purchasedHours: 40, purchaseDate: '2026-09-01', consumptions: rows,
    project: { id: 1, title: 'Техподдержка клиента', clientCompany: null },
  } as SupportHoursPackage
}

describe('Selected support hours package report data', () => {
  it('uses only selected package allocations, not the report total or another package', () => {
    const otherPackage = { ...consumption(2, 70), packageId: 11 }
    const data = buildSupportPackageReportData(packageFixture([consumption(1, 2), otherPackage]), now)
    expect(data).toMatchObject({ packageId: 10, purchasedHours: 40, spentHours: 2, remainingHours: 38 })
    expect(data.tasks[0]).toMatchObject({ hours: 2, reports: [{ id: '1', hours: 2 }] })
  })

  it('merges split allocations into one report row and sums only their hours', () => {
    const first = consumption(1, 1.25)
    const split = { ...first, id: 2, hours: 0.75 }
    const data = buildSupportPackageReportData(packageFixture([first, split]), now)
    expect(data.tasks[0].reports).toHaveLength(1)
    expect(data.tasks[0].reports[0].hours).toBe(2)
    expect(data.spentHours).toBe(2)
  })

  it('includes all package history and today, excluding tomorrow using Moscow dates', () => {
    const data = buildSupportPackageReportData(packageFixture([
      consumption(1, 2),
      consumption(2, 3, { reportDate: new Date('2026-09-29T20:59:59Z') }),
      consumption(3, 5, { reportDate: new Date('2026-09-29T21:00:00Z') }),
    ]), now)
    expect(data.tasks[0].reports.map((row) => row.date)).toEqual(['2026-09-01', '2026-09-29'])
    expect(data.spentHours).toBe(5)
    expect(data.asOfDate).toBe('2026-09-29')
  })

  it('uses Moscow today even before midnight UTC', () => {
    const data = buildSupportPackageReportData(packageFixture(), new Date('2026-09-28T22:00:00Z'))
    expect(data.asOfDate).toBe('2026-09-29')
  })

  it('includes actual work on unfinished tasks and standalone reports without completion claims', () => {
    const data = buildSupportPackageReportData(packageFixture([
      consumption(1, 2, { stageId: 'IN_PROGRESS' }),
      consumption(2, 1.5, { bitrixTaskId: null, taskTitle: null }),
    ]), now)
    expect(data.tasks[0]).toMatchObject({ id: '1002', title: 'Незавершённая задача', hours: 2 })
    expect(data.reportsWithoutTask).toEqual([{ id: '2', date: '2026-09-01', description: 'Работа 2', hours: 1.5 }])
    expect(data.spentHours).toBe(3.5)
  })

  it('falls back to task ID and report title without inventing details', () => {
    const data = buildSupportPackageReportData(packageFixture([consumption(1, 2, { taskTitle: null, reportDescription: null })]), now)
    expect(data.tasks[0].title).toBe('Задача №1002')
    expect(data.tasks[0].reports[0].description).toBe('Отчёт 1')
  })

  it('does not produce a report for a package purchased after today', () => {
    expect(() => buildSupportPackageReportData({ ...packageFixture(), purchaseDate: '2026-10-01' }, now)).toThrow(BadRequestException)
  })

  it('keeps negative balances and does not include an unrelated project client', () => {
    const data = buildSupportPackageReportData(packageFixture([consumption(1, 45), consumption(2, 5, { companyName: 'Другой клиент' })]), now)
    expect(data.remainingHours).toBe(-10)
    expect(data.clientName).toBeNull()
  })
})

describe('Task progress across support packages', () => {
  function fixture(status: SupportPackageTaskContext['status'] = 'in_work', soldHours: number | null = 30): SupportHoursPackageReportSnapshot {
    const selected = consumption(1, 6, { hours: 20 })
    const reports = [
      { ...selected.report, consumptions: [{ packageId: 9, hours: 14 }, { packageId: 10, hours: 6 }] },
      { ...consumption(2, 6, { hours: 6 }).report, consumptions: [{ packageId: 9, hours: 6 }] },
    ] as SupportHoursReport[]
    return { ...packageFixture([selected]), taskContexts: [{ id: '1002', title: 'Общая задача', status, soldHours, reports }] }
  }

  it('shows 26/30 for all unique task reports while charging only the selected 6 hours', () => {
    const data = buildSupportPackageReportData(fixture(), now)
    expect(data).toMatchObject({ spentHours: 6, remainingHours: 34 })
    expect(data.tasks[0]).toMatchObject({ title: 'Общая задача', status: 'in_work', totalHours: 26, soldHours: 30, hours: 6 })
    expect(data.tasks[0].otherPackageReports).toEqual([
      expect.objectContaining({ id: '1', packageId: 9, hours: 14 }),
      expect.objectContaining({ id: '2', packageId: 9, hours: 6 }),
    ])
    expect(data.tasks[0].reports).toEqual([expect.objectContaining({ id: '1', hours: 6 })])
  })

  it.each([30, 0, null])('includes an explicitly assigned task without reports and preserves its %s-hour estimate without charging the package', (soldHours) => {
    const snapshot: SupportHoursPackageReportSnapshot = {
      ...packageFixture([]),
      taskContexts: [{ id: '1002', title: 'Новая задача пакета', status: 'in_work', soldHours, reports: [], assignedToPackage: true }],
    }
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data).toMatchObject({ spentHours: 0, remainingHours: 40, reportsWithoutTask: [] })
    expect(data.tasks).toEqual([{
      id: '1002', title: 'Новая задача пакета', status: 'in_work', soldHours,
      totalHours: 0, hours: 0, reports: [], otherPackageReports: [], unallocatedReports: [],
    }])
  })

  it('includes history from other packages for an assigned task without making new package charges', () => {
    const snapshot = fixture()
    snapshot.consumptions = []
    snapshot.taskContexts[0].assignedToPackage = true
    snapshot.taskContexts[0].reports[0].consumptions = [{ packageId: 9, hours: 20 }] as SupportHoursConsumption[]
    snapshot.taskContexts[0].reports[1].consumptions = []
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data).toMatchObject({ spentHours: 0, remainingHours: 40 })
    expect(data.tasks[0]).toMatchObject({
      totalHours: 26, soldHours: 30, hours: 0, reports: [],
      otherPackageReports: [{ id: '1', packageId: 9, hours: 20 }],
      unallocatedReports: [{ id: '2', hours: 6 }],
    })
  })

  it('does not duplicate an assigned task already represented by package charges', () => {
    const snapshot = fixture()
    snapshot.taskContexts[0].assignedToPackage = true
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0]).toMatchObject({ totalHours: 26, hours: 6 })
    expect(data.spentHours).toBe(6)
  })

  it.each([false, undefined])('keeps a task with neither selected charges nor explicit assignment out of the package (assigned=%s)', (assignedToPackage) => {
    const snapshot = fixture()
    snapshot.consumptions = []
    snapshot.taskContexts[0].assignedToPackage = assignedToPackage
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data.tasks).toEqual([])
    expect(data).toMatchObject({ spentHours: 0, remainingHours: 40 })
  })

  it('uses current completed status even when completion work was charged to another package', () => {
    const snapshot = fixture('completed')
    snapshot.taskContexts[0].reports[1].consumptions[0].packageId = 11
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data.tasks[0].status).toBe('completed')
    expect(data.tasks[0].otherPackageReports[1]).toMatchObject({ packageId: 11, hours: 6 })
    expect(data.spentHours).toBe(6)
  })

  it('does not turn reaching or exceeding the hours limit into task completion', () => {
    const data = buildSupportPackageReportData(fixture('in_work', 20), now)
    expect(data.tasks[0]).toMatchObject({ status: 'in_work', totalHours: 26, soldHours: 20 })
  })

  it('keeps missing budget different from a real zero', () => {
    expect(buildSupportPackageReportData(fixture('in_work', null), now).tasks[0].soldHours).toBeNull()
    expect(buildSupportPackageReportData(fixture('in_work', 0), now).tasks[0].soldHours).toBe(0)
  })

  it('excludes future work from task progress and does not pull unrelated tasks into the package', () => {
    const snapshot = fixture()
    snapshot.taskContexts[0].reports[1].reportDate = new Date('2026-09-29T21:00:00Z')
    snapshot.taskContexts.push({ ...snapshot.taskContexts[0], id: '999' })
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data.tasks).toHaveLength(1)
    expect(data.tasks[0].totalHours).toBe(20)
    expect(data.tasks[0].otherPackageReports).toHaveLength(1)
  })

  it('does not count one report twice when package allocations split its hours', () => {
    const snapshot = fixture()
    snapshot.taskContexts[0].reports.push(snapshot.taskContexts[0].reports[0])
    snapshot.taskContexts[0].reports[0].consumptions = [
      { packageId: 9, hours: 7 }, { packageId: 9, hours: 7 }, { packageId: 10, hours: 6 },
    ] as SupportHoursConsumption[]
    const task = buildSupportPackageReportData(snapshot, now).tasks[0]
    expect(task.totalHours).toBe(26)
    expect(task.otherPackageReports[0].hours).toBe(14)
  })

  it('includes fully unallocated eligible work in task progress without charging the selected package', () => {
    const snapshot = fixture()
    snapshot.taskContexts[0].reports.push({ ...consumption(3, 4, { hours: 4 }).report, consumptions: [] } as SupportHoursReport)
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data).toMatchObject({ spentHours: 6, remainingHours: 34 })
    expect(data.tasks[0]).toMatchObject({ totalHours: 30, hours: 6, unallocatedReports: [{ id: '3', hours: 4 }] })
  })

  it('shows only the unallocated remainder of a partially split report', () => {
    const snapshot = fixture()
    snapshot.taskContexts[0].reports[0].hours = 23
    const data = buildSupportPackageReportData(snapshot, now)
    expect(data.tasks[0]).toMatchObject({ totalHours: 29, hours: 6, unallocatedReports: [{ id: '1', hours: 3 }] })
    expect(data.tasks[0].reports[0].hours).toBe(6)
    expect(data.tasks[0].otherPackageReports[0].hours).toBe(14)
    expect(data.spentHours).toBe(6)
  })

  it('deduplicates unallocated work and excludes future unallocated reports', () => {
    const snapshot = fixture()
    const unallocated = { ...consumption(3, 4, { hours: 4 }).report, consumptions: [] } as SupportHoursReport
    snapshot.taskContexts[0].reports.push(unallocated, unallocated, { ...unallocated, bitrixReportId: '4', reportDate: new Date('2026-09-30T10:00:00Z') })
    const task = buildSupportPackageReportData(snapshot, now).tasks[0]
    expect(task.totalHours).toBe(30)
    expect(task.unallocatedReports).toHaveLength(1)
    expect(task.unallocatedReports![0]).toMatchObject({ id: '3', hours: 4 })
  })
})

describe('Fresh serialized package snapshot', () => {
  function fixture() {
    const calls: string[] = []
    const packagesRepository = { findOne: jest.fn(() => { calls.push('exists'); return Promise.resolve(packageFixture([consumption(80, 80)])) }) }
    const snapshotRepository = { findOne: jest.fn(() => { calls.push('snapshot'); return Promise.resolve(packageFixture([consumption(1, 7, { bitrixTaskId: null })])) }) }
    const dataSource = {
      getRepository: (entity: unknown) => {
        if (entity === SupportHoursTransfer) return { findOne: jest.fn().mockResolvedValue(null) }
        throw new Error('Unexpected repository')
      },
      transaction: jest.fn((operation) => {
        calls.push('transaction')
        return operation({ getRepository: (entity: unknown) => entity === SupportTaskAssignment ? { find: jest.fn().mockResolvedValue([]) } : snapshotRepository })
      }),
    }
    const service = new SupportHoursPackagesService({} as never, packagesRepository as never, {} as never, {} as never, dataSource as never, {} as never)
    const sync = jest.spyOn(service, 'sync').mockImplementation(() => {
      calls.push('sync')
      return Promise.resolve({ processedReports: 1, synchronizedAt: now.toISOString() })
    })
    return { service, calls, sync, packagesRepository, snapshotRepository }
  }

  it('awaits reconciliation then reads the selected package, removing deleted cached hours', async () => {
    const f = fixture()
    const snapshot = await f.service.getReportSnapshot(10)
    expect(f.calls).toEqual(['exists', 'sync', 'exists', 'transaction', 'snapshot'])
    expect(f.snapshotRepository.findOne).toHaveBeenCalledWith({ where: { id: 10 }, relations: { project: true, consumptions: { report: true } } })
    expect(buildSupportPackageReportData(snapshot, now).spentHours).toBe(7)
  })

  it('rejects unknown packages without running a portal reconciliation', async () => {
    const f = fixture()
    f.packagesRepository.findOne.mockResolvedValueOnce(null as never)
    await expect(f.service.getReportSnapshot(999)).rejects.toBeInstanceOf(NotFoundException)
    expect(f.sync).not.toHaveBeenCalled()
  })

  it('does not export stale figures when refreshing fails', async () => {
    const f = fixture()
    f.sync.mockRejectedValueOnce(new BadGatewayException('Bitrix unavailable'))
    await expect(f.service.getReportSnapshot(10)).rejects.toThrow('Bitrix unavailable')
    expect(f.snapshotRepository.findOne).not.toHaveBeenCalled()
  })

  it.each([0, -1, 1.5])('rejects invalid package ID %s', async (id) => {
    const f = fixture()
    await expect(f.service.getReportSnapshot(id)).rejects.toBeInstanceOf(BadRequestException)
    expect(f.sync).not.toHaveBeenCalled()
  })
})

describe('Package PDF response', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(now) })
  afterEach(() => { jest.useRealTimers() })
  it('renders fresh package data and returns a binary attachment', async () => {
    const packages = { getReportSnapshot: jest.fn().mockResolvedValue(packageFixture([consumption(1, 7)])) }
    const pdf = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')) }
    const reportService = new SupportHoursPackageReportService(packages as never, pdf as never, { inspect: jest.fn().mockResolvedValue({ blocking: false }) } as never)
    const controller = new SupportHoursPackagesController({} as never, reportService, {} as never, {} as never, {} as never, {} as never)
    const response = await controller.downloadPackageReport(10)
    expect(packages.getReportSnapshot).toHaveBeenCalledWith(10)
    const [html] = pdf.generatePdf.mock.calls[0]
    expect(html).toContain('Техподдержка клиента')
    expect(html).toContain('Работа 1')
    expect(response.getHeaders()).toMatchObject({ type: 'application/pdf', disposition: expect.stringMatching(/^attachment; filename="support-package-10-\d{4}-\d{2}-\d{2}\.pdf"$/) })
    expect(response.getHeaders().length).toBe(Buffer.byteLength('%PDF-test'))
  })
})
