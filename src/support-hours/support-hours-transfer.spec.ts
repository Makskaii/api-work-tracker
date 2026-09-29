import { planSupportTransfer } from './support-hours-transfer'
import type { SupportProjectWorkspace } from './support-hours-workspace'

function workspace(options: { remaining?: number; excluded?: boolean; second?: boolean } = {}): SupportProjectWorkspace {
  const consumed = 10 - (options.remaining ?? 3)
  return { projectId: 1, tasks: [{ id: '10', title: 'Task', stageId: 'NEW' }, { id: '20', title: 'Empty', stageId: 'NEW' }], reports: [
    { id: '1', taskId: null, taskTitle: null, responsibleName: null, date: '2026-09-01', hours: consumed, title: 'Old', description: null, includeInPackage: true, allocations: [{ purchaseId: 1, purchaseDate: '2026-09-01', hours: consumed }], allocatedHours: consumed, unallocatedHours: 0 },
    { id: '2', taskId: '10', taskTitle: 'Task', responsibleName: null, date: '2026-09-02', hours: 5, title: 'New', description: null, includeInPackage: !options.excluded, allocations: options.second ? [{ purchaseId: 2, purchaseDate: '2026-09-02', hours: 5 }] : [], allocatedHours: options.second ? 5 : 0, unallocatedHours: options.second ? 0 : 5 },
  ], packageGroup: { packages: [
    { id: 1, projectId: 1, purchaseDate: '2026-09-01', purchasedHours: 10, consumptions: [{ hours: consumed }] },
    ...(options.second ? [{ id: 2, projectId: 1, purchaseDate: '2026-09-02', purchasedHours: 10, consumptions: [{ hours: 5 }] }] : []),
  ] } } as SupportProjectWorkspace
}
const move = { fromPurchaseId: null, toPurchaseId: 1, items: [{ reportId: '2', hours: 5 }] }
describe('Manual support transfer planning', () => {
  it('allocates only three of five hours and preserves two hours unallocated', () => {
    const plan = planSupportTransfer(workspace({ excluded: true }), move)
    expect(plan.preview).toMatchObject({ movedHours: 3, unallocatedHours: 2, items: [{ reportId: '2', hours: 3 }] })
    expect(plan.assignments.find((row) => row.bitrixReportId === '2')?.allocations).toEqual([{ packageId: 1, hours: 3 }])
    expect(plan.reports[0].includeInPackage).toBe(true)
    expect(plan.preview.packages[0].after.remainingHours).toBe(0)
  })
  it('moves the overflow from another package into unallocated rather than back to its source', () => {
    const plan = planSupportTransfer(workspace({ second: true }), { ...move, fromPurchaseId: 2 })
    expect(plan.preview.packages[1].after.remainingHours).toBe(10)
    expect(plan.preview.unallocatedHours).toBe(2)
  })
  it('clears accounting only when the report has no remaining package allocation', () => {
    const source = workspace({ second: true })
    const all = planSupportTransfer(source, { fromPurchaseId: 2, toPurchaseId: null, items: [{ reportId: '2', hours: 5 }] })
    expect(all.reports[0].includeInPackage).toBe(false)
    const partial = planSupportTransfer(source, { fromPurchaseId: 2, toPurchaseId: null, items: [{ reportId: '2', hours: 2 }] })
    expect(partial.reports[0].includeInPackage).toBe(true)
    expect(partial.assignments[1].allocations).toEqual([{ packageId: 2, hours: 3 }])
  })
  it('persists an empty task destination without inventing a charge', () => {
    const plan = planSupportTransfer(workspace(), { fromPurchaseId: null, toPurchaseId: 1, taskId: '20', items: [] })
    expect(plan.preview).toMatchObject({ movedHours: 0, taskTitle: 'Empty' })
    expect(plan.request.taskId).toBe('20')
  })
  it('rejects stale source hours, missing tasks, duplicate reports and foreign packages', () => {
    expect(() => planSupportTransfer(workspace(), { ...move, items: [{ reportId: '2', hours: 6 }] })).toThrow('Часы отчёта изменились')
    expect(() => planSupportTransfer(workspace(), { ...move, taskId: '999' })).toThrow('Задача не относится')
    expect(() => planSupportTransfer(workspace(), { ...move, items: [...move.items, ...move.items] })).toThrow('несколько раз')
    expect(() => planSupportTransfer(workspace(), { ...move, toPurchaseId: 99 })).toThrow('Пакет не относится')
  })
  it('requires all source reports of a task, while standalone report movement stays independent', () => {
    expect(() => planSupportTransfer(workspace(), { ...move, taskId: '10', items: [] })).toThrow('Состав отчётов задачи изменился')
    expect(planSupportTransfer(workspace(), { ...move, taskId: '10' }).reports).toHaveLength(1)
  })
  it('changes the fingerprint after report, package or task binding edits', () => {
    const original = workspace()
    const before = planSupportTransfer(original, move).preview.fingerprint
    original.tasks[1].purchaseId = 1
    expect(planSupportTransfer(original, move).preview.fingerprint).not.toBe(before)
  })
  it('does not mutate the source snapshot', () => {
    const original = workspace({ second: true })
    const before = structuredClone(original)
    planSupportTransfer(original, { ...move, fromPurchaseId: 2 })
    expect(original).toEqual(before)
  })
  it('normalizes an existing overrun using the same caps as the persisted allocator', () => {
    const source = workspace({ remaining: -2 })
    const plan = planSupportTransfer(source, { fromPurchaseId: null, toPurchaseId: 1, taskId: '20', items: [] })
    expect(plan.preview.packages[0].after.remainingHours).toBe(0)
    expect(plan.assignments[0].allocations).toEqual([{ packageId: 1, hours: 10 }])
  })
})
