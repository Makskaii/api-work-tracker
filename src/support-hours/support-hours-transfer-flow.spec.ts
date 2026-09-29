import { BadGatewayException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { DailyReportCodes, EntityTypeIds, TaskCodes } from '../constants/const'
import { ReportProject, ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import type { TransferSupportHoursDto } from './dto/transfer-support-hours.dto'
import { SupportHoursAssignment } from './entities/support-hours-assignment.entity'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursTransfer } from './entities/support-hours-transfer.entity'
import { SupportTaskAssignment } from './entities/support-task-assignment.entity'
import { SupportHoursPackagesService } from './support-hours-packages.service'
import type { SupportProjectWorkspace } from './support-hours-workspace'

const token = 'scoped-user-token'
const operationId = 'fd607412-89d1-4cf5-aef3-fcfa24ac45bc'
const date = new Date('2026-09-29T09:00:00Z')
const clone = <T>(value: T): T => structuredClone(value)
type PrivateService = {
  readProjectWorkspace(id: number): Promise<SupportProjectWorkspace>
  prepareEligibleReport(value: Record<string, unknown>): Promise<SupportHoursReport | null>
}

function fixture() {
  const project = Object.assign(new ReportProject(), { id: 31, bitrixProjectId: '94', title: 'Project', projectType: ReportProjectType.Support })
  const pack = Object.assign(new SupportHoursPackage(), { id: 7, projectId: 31, project, purchasedHours: 20, purchaseDate: '2026-09-01', updatedAt: date, consumptions: [], remainingHours: 20 })
  const workspace: SupportProjectWorkspace = {
    projectId: 31,
    tasks: [{ id: '900', title: 'Task', stageId: 'NEW' }],
    reports: ['100', '101', '102'].map((id) => ({
      id, taskId: null, taskTitle: null, responsibleName: null, date: '2026-09-29', hours: 2,
      title: 'Report', description: 'Work', includeInPackage: false, allocations: [], allocatedHours: 0, unallocatedHours: 2,
    })),
    packageGroup: { project, purchasedHours: 20, consumedHours: 0, remainingHours: 20, state: 'active', lastChargeAt: null, packages: [pack] },
  }
  const request: TransferSupportHoursDto = { fromPurchaseId: null, toPurchaseId: 7, items: workspace.reports.map((report) => ({ reportId: report.id, hours: report.hours })) }
  const live = new Map(workspace.reports.map((report) => [Number(report.id), {
    id: Number(report.id), [DailyReportCodes.parentproject]: '94', [DailyReportCodes.parentId]: 0,
    [DailyReportCodes.timeSpent]: report.hours, [DailyReportCodes.includeInPackage]: 'N',
    begindate: date.toISOString(), createdTime: date.toISOString(),
  } as Record<string, unknown>]))
  let operations: SupportHoursTransfer[] = []
  let reports: SupportHoursReport[] = []
  let assignments: SupportHoursAssignment[] = []
  let taskAssignments: SupportTaskAssignment[] = []
  let consumptions: { reportId: number; packageId: number; hours: number }[] = []
  const matches = (row: object, where: object): boolean => Object.entries(where).every(([key, value]) => row[key] === value)
  const operationRepo = {
    create: jest.fn((value) => Object.assign(new SupportHoursTransfer(), value)),
    findOne: jest.fn(({ where }) => Promise.resolve(clone(operations.find((row) => matches(row, where)) ?? null))),
    save: jest.fn((value: SupportHoursTransfer) => {
      const row = clone(value)
      const index = operations.findIndex((item) => item.id === row.id)
      if (index < 0) operations.push(row)
      else operations[index] = row
      return Promise.resolve(clone(row))
    }),
  }
  const assignmentRepo = {
    create: jest.fn((value) => Object.assign(new SupportHoursAssignment(), value)),
    findOne: jest.fn(({ where }) => Promise.resolve(clone(assignments.find((row) => matches(row, where)) ?? null))),
    find: jest.fn(({ where }) => Promise.resolve(clone(assignments.filter((row) => matches(row, where))))),
    save: jest.fn((value: SupportHoursAssignment) => {
      const index = assignments.findIndex((row) => row.projectId === value.projectId && row.bitrixReportId === value.bitrixReportId)
      if (index < 0) assignments.push(clone(value))
      else assignments[index] = clone(value)
      return Promise.resolve(value)
    }),
  }
  const taskRepo = {
    create: jest.fn((value) => Object.assign(new SupportTaskAssignment(), value)),
    findOne: jest.fn(({ where }) => Promise.resolve(clone(taskAssignments.find((row) => matches(row, where)) ?? null))),
    find: jest.fn(({ where }) => Promise.resolve(clone(taskAssignments.filter((row) => matches(row, where))))),
    save: jest.fn((value: SupportTaskAssignment) => { taskAssignments.push(clone(value)); return Promise.resolve(value) }),
  }
  const reportRepo = {
    create: jest.fn((value) => Object.assign(new SupportHoursReport(), value)),
    merge: jest.fn((target, value) => Object.assign(target, Object.fromEntries(Object.entries(value).filter(([, value]) => value !== undefined)))),
    findOne: jest.fn(({ where }) => Promise.resolve(clone(reports.find((row) => matches(row, where)) ?? null))),
    find: jest.fn(({ where } = {}) => Promise.resolve(clone(reports.filter((row) => !where || matches(row, where))))),
    save: jest.fn((value: SupportHoursReport) => {
      const index = reports.findIndex((row) => row.bitrixReportId === value.bitrixReportId)
      const row = clone({ ...value, id: index < 0 ? reports.length + 1 : reports[index].id })
      if (index < 0) reports.push(row)
      else reports[index] = row
      return Promise.resolve(row)
    }),
    remove: jest.fn((value: SupportHoursReport) => { reports = reports.filter((row) => row.bitrixReportId !== value.bitrixReportId); return Promise.resolve(value) }),
  }
  const packageRepo = {
    findOne: jest.fn(({ where }) => Promise.resolve(where.id === pack.id ? clone(pack) : null)),
    find: jest.fn(() => Promise.resolve([clone(pack)])),
    save: jest.fn(), create: jest.fn(), remove: jest.fn(),
  }
  const consumptionRepo = {
    delete: jest.fn(() => { consumptions = []; return Promise.resolve({}) }),
    create: jest.fn((value) => value),
    save: jest.fn((values) => { consumptions = clone(values); return Promise.resolve(values) }),
  }
  const repositories = new Map<unknown, unknown>([
    [SupportHoursTransfer, operationRepo], [SupportHoursAssignment, assignmentRepo],
    [SupportTaskAssignment, taskRepo], [SupportHoursReport, reportRepo],
    [SupportHoursPackage, packageRepo], [SupportHoursConsumption, consumptionRepo],
  ])
  const manager = { getRepository(entity: unknown) { const repository = repositories.get(entity); if (!repository) throw new Error('Unexpected repository'); return repository } }
  const dataSource = {
    getRepository: manager.getRepository,
    transaction: jest.fn(async (operation) => {
      const previous = clone({ operations, reports, assignments, taskAssignments, consumptions })
      try { return await operation(manager) } catch (error) {
        ;({ operations, reports, assignments, taskAssignments, consumptions } = previous)
        throw error
      }
    }),
  }
  let failedReportId: number | null = null
  const userBitrix = {
    verifyUser: jest.fn().mockResolvedValue({ id: 12 }),
    getItem: jest.fn((_token: string, entityTypeId: number, id: number) => {
      if (entityTypeId === EntityTypeIds.tasks) return Promise.resolve({ id, [TaskCodes.parentproject]: '94' })
      const value = live.get(id)
      return value ? Promise.resolve(clone(value)) : Promise.reject(new NotFoundException())
    }),
    setReportAccounting: jest.fn((_token: string, id: number, enabled: boolean) => {
      if (id === failedReportId) return Promise.reject(new ForbiddenException('Недостаточно прав'))
      const value = live.get(id)
      if (!value) return Promise.reject(new NotFoundException())
      value[DailyReportCodes.includeInPackage] = enabled ? 'Y' : 'N'
      return Promise.resolve({ id, includeInPackage: enabled })
    }),
  }
  const bitrix = { getItem: jest.fn(({ id }) => Promise.resolve(clone(live.get(id)))), updateItem: jest.fn(), addItem: jest.fn() }
  const projectRepo = { findOne: jest.fn().mockResolvedValue(project) }
  const service = new SupportHoursPackagesService(projectRepo as never, packageRepo as never, reportRepo as never, consumptionRepo as never,
    dataSource as never, bitrix as never, undefined, userBitrix as never)
  const internals = service as unknown as PrivateService
  const workspaceRead = jest.spyOn(internals, 'readProjectWorkspace').mockResolvedValue(workspace)
  const prepareReport = jest.spyOn(internals, 'prepareEligibleReport').mockImplementation((value) => Promise.resolve(value[DailyReportCodes.includeInPackage] !== 'Y' ? null : Object.assign(new SupportHoursReport(), {
    bitrixReportId: String(value.id), projectId: 31, hours: Number(value[DailyReportCodes.timeSpent]),
    bitrixTaskId: null, reportDate: date, lastActivityAt: date, reportDescription: 'Work',
  })))
  const snapshot = () => clone({ operations, reports, assignments, taskAssignments, consumptions })
  return { service, request, workspace, workspaceRead, token, userBitrix, bitrix, live, operationRepo, assignmentRepo, reportRepo, packageRepo,
    consumptionRepo, dataSource, projectRepo, prepareReport, snapshot, failReport: (id: number | null) => { failedReportId = id } }
}

describe('Durable support transfer flow', () => {
  it('saves intent before external writes, preserves it after a partial failure and returns its recovery ID', async () => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    f.failReport(101)
    await expect(f.service.transfer(31, f.request, preview.fingerprint, token, operationId)).rejects.toMatchObject({ response: { pendingTransferId: operationId } })
    expect(f.snapshot().operations).toEqual([expect.objectContaining({ id: operationId, actorId: 12, status: 'pending' })])
    expect(f.operationRepo.save.mock.invocationCallOrder[0]).toBeLessThan(f.userBitrix.setReportAccounting.mock.invocationCallOrder[0])
    expect(f.live.get(100)?.[DailyReportCodes.includeInPackage]).toBe('Y')
    expect(f.live.get(101)?.[DailyReportCodes.includeInPackage]).toBe('N')
    expect(f.snapshot().assignments).toEqual([])
    expect(f.snapshot().consumptions).toEqual([])
    expect(JSON.stringify(f.snapshot().operations)).not.toContain(token)
    expect(f.bitrix.updateItem).not.toHaveBeenCalled()
  })

  it('completes a pending transfer on retry and makes a repeated completed request idempotent', async () => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    f.failReport(101)
    await f.service.transfer(31, f.request, preview.fingerprint, token, operationId).catch(() => undefined)
    f.failReport(null)
    const result = await f.service.resumeTransfer(31, operationId, token)
    expect(result).toMatchObject({ operationId, movedHours: 6 })
    const saved = f.snapshot()
    expect(saved.operations[0].status).toBe('complete')
    expect(saved.assignments).toHaveLength(3)
    expect(saved.reports).toHaveLength(3)
    expect(saved.consumptions.reduce((sum, row) => sum + row.hours, 0)).toBe(6)
    const writes = f.userBitrix.setReportAccounting.mock.calls.length
    await f.service.transfer(31, f.request, preview.fingerprint, token, operationId)
    expect(f.snapshot()).toEqual(saved)
    expect(f.userBitrix.setReportAccounting).toHaveBeenCalledTimes(writes)
  })

  it('rejects a report moved to another project before persisting an intent or writing a flag', async () => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    f.live.get(101)![DailyReportCodes.parentproject] = '95'
    await expect(f.service.transfer(31, f.request, preview.fingerprint, token, operationId)).rejects.toBeInstanceOf(ConflictException)
    expect(f.operationRepo.save).not.toHaveBeenCalled()
    expect(f.userBitrix.setReportAccounting).not.toHaveBeenCalled()
  })

  it('rejects a stale fingerprint before creating an intent or changing Bitrix', async () => {
    const f = fixture()
    await expect(f.service.transfer(31, f.request, 'stale', token, operationId)).rejects.toBeInstanceOf(ConflictException)
    expect(f.operationRepo.save).not.toHaveBeenCalled()
    expect(f.userBitrix.setReportAccounting).not.toHaveBeenCalled()
  })

  it.each([
    ['project', DailyReportCodes.parentproject, '95'],
    ['hours', DailyReportCodes.timeSpent, 3],
    ['task binding', DailyReportCodes.parentId, '900'],
    ['report identity', 'id', 999],
  ])('does not commit when the final report snapshot changes its %s after the permission check', async (_label, field, value) => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    f.bitrix.getItem.mockImplementationOnce(({ id }) => Promise.resolve({ ...clone(f.live.get(id)), [field]: value }))

    await expect(f.service.transfer(31, f.request, preview.fingerprint, token, operationId)).rejects.toMatchObject({ response: { pendingTransferId: operationId } })

    // All OAuth checks and writes succeeded; only the final snapshot diverged.
    expect(f.userBitrix.setReportAccounting).toHaveBeenCalledTimes(3)
    expect(f.prepareReport).not.toHaveBeenCalled()
    expect(f.snapshot().operations[0].status).toBe('pending')
    expect(f.snapshot().assignments).toEqual([])
    expect(f.snapshot().reports).toEqual([])
    expect(f.snapshot().consumptions).toEqual([])
    expect(f.dataSource.transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['database failure', () => new Error(`SQL connection failed: password=private ${token}`)],
    ['privileged Bitrix failure', () => new BadGatewayException(`GET https://portal/rest/private/?auth=${token} failed`)],
  ])('hides internal details after a %s and still returns the recovery ID', async (_label, failure) => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    const error = failure()
    if (error instanceof BadGatewayException) f.bitrix.getItem.mockRejectedValueOnce(error)
    else f.assignmentRepo.save.mockRejectedValueOnce(error)

    await expect(f.service.transfer(31, f.request, preview.fingerprint, token, operationId)).rejects.toMatchObject({
      response: { message: 'Перенос не завершён. Продолжите его или отмените.', pendingTransferId: operationId },
    })
    expect(f.snapshot().operations[0].status).toBe('pending')
    expect(JSON.stringify(f.snapshot().operations)).not.toContain(token)
    expect(f.snapshot().assignments).toEqual([])
  })

  it('keeps an intent pending when a later database write fails after successful Bitrix changes', async () => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    f.assignmentRepo.save.mockRejectedValueOnce(new BadGatewayException('Database unavailable'))
    await expect(f.service.transfer(31, f.request, preview.fingerprint, token, operationId)).rejects.toMatchObject({ response: { pendingTransferId: operationId } })
    expect(f.snapshot().operations[0].status).toBe('pending')
    expect(f.snapshot().reports).toEqual([])
    expect(f.snapshot().assignments).toEqual([])
    await expect(f.service.resumeTransfer(31, operationId, token)).resolves.toMatchObject({ operationId })
    expect(f.snapshot().operations[0].status).toBe('complete')
  })

  it('freezes package mutations and current PDF generation while a project has a pending transfer', async () => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    f.failReport(101)
    await f.service.transfer(31, f.request, preview.fingerprint, token, operationId).catch(() => undefined)
    jest.spyOn(f.service, 'sync').mockResolvedValue({ processedReports: 0, synchronizedAt: date.toISOString() })
    await expect(f.service.create({ projectId: 31, purchasedHours: 10, purchaseDate: '2026-09-30' })).rejects.toMatchObject({ response: { pendingTransferId: operationId } })
    await expect(f.service.update(7, { comment: 'Changed' })).rejects.toMatchObject({ response: { pendingTransferId: operationId } })
    await expect(f.service.remove(7)).rejects.toMatchObject({ response: { pendingTransferId: operationId } })
    await expect(f.service.getReportSnapshot(7)).rejects.toMatchObject({ response: { pendingTransferId: operationId } })
    expect(f.packageRepo.create).not.toHaveBeenCalled()
    expect(f.packageRepo.save).not.toHaveBeenCalled()
    expect(f.packageRepo.remove).not.toHaveBeenCalled()
  })

  it('cancels flags changed by the intent without reverting a never-attempted report changed by another user', async () => {
    const f = fixture()
    const preview = await f.service.previewTransfer(31, f.request, token)
    f.failReport(101)
    await f.service.transfer(31, f.request, preview.fingerprint, token, operationId).catch(() => undefined)
    f.live.get(102)![DailyReportCodes.includeInPackage] = 'Y'
    f.userBitrix.setReportAccounting.mockClear()
    await expect(f.service.resumeTransfer(31, operationId, token, true)).resolves.toMatchObject({ operationId, cancelled: true })
    expect(f.userBitrix.setReportAccounting).toHaveBeenCalledTimes(1)
    expect(f.userBitrix.setReportAccounting).toHaveBeenCalledWith(token, 100, false)
    expect(f.live.get(100)?.[DailyReportCodes.includeInPackage]).toBe('N')
    expect(f.live.get(102)?.[DailyReportCodes.includeInPackage]).toBe('Y')
    expect(f.snapshot().operations[0]).toMatchObject({ status: 'complete', payload: { cancelled: true } })
    expect(f.snapshot().assignments).toEqual([])
  })
})
