import { BadGatewayException } from '@nestjs/common'
import { EntityTypeIds, TaskCodes } from '../constants/const'
import { ReportProject } from '../project-reports/entities/project-report-project.entity'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import type { SupportHoursPackageReportSnapshot, SupportPackageTaskContext } from './support-hours-package-report.types'
import { SupportPackageChecksService } from './support-package-checks.service'

const now = new Date('2026-09-29T10:00:00Z')
const report = (id: string, hours: number, taskId: string | null = '1002', description = 'Выполненная работа') => Object.assign(new SupportHoursReport(), {
  bitrixReportId: id, bitrixTaskId: taskId, reportDescription: description,
  hours, reportDate: new Date('2026-09-01T10:00:00Z'), consumptions: [],
})
const snapshot = (reports: SupportHoursReport[], contexts: SupportPackageTaskContext[] = []): SupportHoursPackageReportSnapshot => Object.assign(new SupportHoursPackage(), {
  id: 7, projectId: 31, project: Object.assign(new ReportProject(), { id: 31, bitrixProjectId: '94' }),
  consumptions: reports.map((item) => Object.assign(new SupportHoursConsumption(), { packageId: 7, hours: item.hours, report: item })),
  taskContexts: contexts,
})
const context = (reports: SupportHoursReport[], changes: Partial<SupportPackageTaskContext> = {}): SupportPackageTaskContext => ({
  id: '1002', title: 'Исправление загрузки', status: 'in_work', soldHours: 10, reports, ...changes,
})

function fixture(value: SupportHoursPackageReportSnapshot) {
  const packages = { getReportSnapshot: jest.fn().mockResolvedValue(value) }
  const bitrix = { listAllItems: jest.fn().mockResolvedValue([{ id: 1002, [TaskCodes.parentproject]: '94' }]) }
  return { packages, bitrix, service: new SupportPackageChecksService(packages as never, bitrix as never) }
}

describe('SupportPackageChecksService', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(now) })
  afterEach(() => { jest.useRealTimers() })

  it('checks a fresh snapshot while keeping warnings non-blocking and leaving data unchanged', async () => {
    const row = report('5402', 2)
    const value = snapshot([row], [context([row], { soldHours: null })])
    const before = JSON.stringify(value)
    const f = fixture(value)
    const result = await f.service.check(7)
    expect(f.packages.getReportSnapshot).toHaveBeenCalledWith(7)
    expect(result).toMatchObject({ checkedAt: now.toISOString(), blocking: false, issues: [{ code: 'missing_task_hours', severity: 'warning', entityTypeId: EntityTypeIds.tasks, itemId: '1002' }] })
    expect(JSON.stringify(value)).toBe(before)
  })

  it('uses unique report totals across all packages and does not double-count split charges', async () => {
    const old = report('5001', 7)
    const current = report('5402', 5)
    old.consumptions = [Object.assign(new SupportHoursConsumption(), { packageId: 6, hours: 4 }), Object.assign(new SupportHoursConsumption(), { packageId: 7, hours: 3 })]
    const value = snapshot([old, current], [context([old, old, current], { soldHours: 12 })])
    const f = fixture(value)
    expect((await f.service.inspect(value)).issues).toEqual([])
    value.taskContexts[0].soldHours = 10
    const result = await f.service.inspect(value)
    expect(result.blocking).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ code: 'task_over_limit', severity: 'warning' })
    expect(result.issues[0].message).toContain('учтено 12 ч')
  })

  it('does not infer unfinished work from excess hours for a completed task', async () => {
    const row = report('5402', 12)
    const value = snapshot([row], [context([row], { status: 'completed', soldHours: 10 })])
    expect((await fixture(value).service.inspect(value)).issues).toEqual([])
  })

  it('flags empty rich-text descriptions once per report without blocking export', async () => {
    const row = report('5402', 2, '1002', '<p>&nbsp;</p>')
    const value = snapshot([row], [context([row, row])])
    const result = await fixture(value).service.inspect(value)
    expect(result.blocking).toBe(false)
    expect(result.issues).toEqual([expect.objectContaining({ code: 'missing_description', entityTypeId: EntityTypeIds.reports, itemId: '5402' })])
  })

  it('blocks a report linked to a task from another project with a direct report reference', async () => {
    const value = snapshot([report('5402', 2)])
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue([{ id: 1002, [TaskCodes.parentproject]: '95' }])
    const result = await f.service.inspect(value)
    expect(result).toMatchObject({ blocking: true, issues: [{ code: 'project_mismatch', severity: 'error', entityTypeId: EntityTypeIds.reports, itemId: '5402' }] })
  })

  it('keeps a deleted task as a non-blocking actionable warning instead of deleting report history', async () => {
    const row = report('5402', 2)
    const value = snapshot([row])
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue([])
    const result = await f.service.inspect(value)
    expect(result).toMatchObject({ blocking: false, issues: [{ code: 'task_unavailable', severity: 'warning', entityTypeId: EntityTypeIds.reports, itemId: '5402' }] })
    expect(value.consumptions[0].report).toBe(row)
  })

  it('supports standalone reports without requesting a fabricated task', async () => {
    const value = snapshot([report('5402', 2, null)])
    const f = fixture(value)
    expect((await f.service.inspect(value)).issues).toEqual([])
    expect(f.bitrix.listAllItems).not.toHaveBeenCalled()
  })

  it('ignores future-dated reports excluded from the current PDF', async () => {
    const future = report('5500', 2, '1003', '')
    future.reportDate = new Date('2026-09-30T00:00:00Z')
    const value = snapshot([report('5402', 2, null), future])
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue([{ id: 1003, [TaskCodes.parentproject]: '95' }])
    const result = await f.service.inspect(value)
    expect(result).toMatchObject({ blocking: false, issues: [] })
    expect(f.bitrix.listAllItems).not.toHaveBeenCalled()
  })

  it('rejects malformed task lookup responses instead of treating them as verified', async () => {
    const value = snapshot([report('5402', 2)])
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue([{ id: 1002 }])
    await expect(f.service.inspect(value)).rejects.toBeInstanceOf(BadGatewayException)
    f.bitrix.listAllItems.mockResolvedValue([{ id: 555, [TaskCodes.parentproject]: '94' }])
    await expect(f.service.inspect(value)).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('looks up shared task IDs once while linking each mismatched report to its own correction action', async () => {
    const value = snapshot([report('5402', 2), report('5403', 3)])
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue([{ id: 1002, [TaskCodes.parentproject]: '95' }])
    const result = await f.service.inspect(value)
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({ filter: { '@id': ['1002'] } }))
    expect(result.issues.map((issue) => issue.itemId)).toEqual(['5402', '5403'])
  })

  it('checks an explicitly assigned task with no reports and warns when its hour limit is missing', async () => {
    const value = snapshot([], [context([], { assignedToPackage: true, soldHours: null })])
    const f = fixture(value)
    const result = await f.service.inspect(value)
    expect(result).toMatchObject({ blocking: false, issues: [{ code: 'missing_task_hours', severity: 'warning', entityTypeId: EntityTypeIds.tasks, itemId: '1002' }] })
    expect(f.bitrix.listAllItems).toHaveBeenCalledTimes(1)
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith({
      entityTypeId: EntityTypeIds.tasks, filter: { '@id': ['1002'] }, select: ['id', TaskCodes.parentproject],
    })
  })

  it('blocks an assigned task without reports if its live project membership changed', async () => {
    const value = snapshot([], [context([], { assignedToPackage: true })])
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue([{ id: 1002, [TaskCodes.parentproject]: '95' }])
    expect(await f.service.inspect(value)).toMatchObject({
      blocking: true,
      issues: [{ code: 'project_mismatch', severity: 'error', entityTypeId: EntityTypeIds.tasks, itemId: '1002' }],
    })
  })

  it('warns about an unavailable assigned task without fabricating or deleting report history', async () => {
    const value = snapshot([], [context([], { assignedToPackage: true })])
    const before = JSON.stringify(value)
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue([])
    expect(await f.service.inspect(value)).toMatchObject({
      blocking: false,
      issues: [{ code: 'task_unavailable', severity: 'warning', entityTypeId: EntityTypeIds.tasks, itemId: '1002' }],
    })
    expect(JSON.stringify(value)).toBe(before)
  })

  it.each(['unavailable', 'foreign'])('keeps existing report correction actions without duplicate assigned-task issues (%s)', async (state) => {
    const rows = [report('5402', 2), report('5403', 3)]
    const value = snapshot(rows, [context(rows, { assignedToPackage: true })])
    const f = fixture(value)
    f.bitrix.listAllItems.mockResolvedValue(state === 'unavailable' ? [] : [{ id: 1002, [TaskCodes.parentproject]: '95' }])
    const result = await f.service.inspect(value)
    expect(f.bitrix.listAllItems).toHaveBeenCalledWith(expect.objectContaining({ filter: { '@id': ['1002'] } }))
    expect(result.issues).toEqual(rows.map((row) => expect.objectContaining({
      code: state === 'unavailable' ? 'task_unavailable' : 'project_mismatch',
      entityTypeId: EntityTypeIds.reports, itemId: row.bitrixReportId,
    })))
  })
})
