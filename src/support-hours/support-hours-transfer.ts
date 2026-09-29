import { BadRequestException, ConflictException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { TransferSupportHoursDto } from './dto/transfer-support-hours.dto'
import type { SupportProjectWorkspace } from './support-hours-workspace'
import { allocateProjectSupportHours } from './support-hours-allocation'

const cents = (hours: number) => Math.round(hours * 100)
const hours = (value: number) => value / 100
export type TransferAllocation = { packageId: number; hours: number }
export type TransferPlan = {
  request: TransferSupportHoursDto
  projectId: number
  assignments: { bitrixReportId: string; allocations: TransferAllocation[] }[]
  reports: { id: string; hours: number; taskId: string | null; includeInPackage: boolean }[]
  preview: {
    fingerprint: string; movedHours: number; unallocatedHours: number
    items: { reportId: string; hours: number }[]
    packages: { id: number; before: TransferBalance; after: TransferBalance }[]
    taskTitle?: string
  }
}
type TransferBalance = { purchasedHours: number; consumedHours: number; remainingHours: number }

export function planSupportTransfer(workspace: SupportProjectWorkspace, request: TransferSupportHoursDto): TransferPlan {
  const from = request.fromPurchaseId ?? null
  const to = request.toPurchaseId ?? null
  if (from === to) throw new BadRequestException('Выберите другой пакет или «Нераспределённое»')
  const packages = workspace.packageGroup.packages
  for (const id of [from, to]) if (id != null && !packages.some((item) => Number(item.id) === id)) throw new BadRequestException('Пакет не относится к этому проекту')
  const task = request.taskId ? workspace.tasks.find((item) => item.id === request.taskId) : null
  if (request.taskId && !task) throw new BadRequestException('Задача не относится к этому проекту')
  if (!request.items.length && !task) throw new BadRequestException('Выберите отчёт или задачу')
  const unique = new Set(request.items.map((item) => item.reportId))
  if (unique.size !== request.items.length) throw new BadRequestException('Отчёт указан несколько раз')
  const available = (report: SupportProjectWorkspace['reports'][number]) => from === null
    ? cents(report.hours) - report.allocations.reduce((sum, row) => sum + cents(row.hours), 0)
    : report.allocations.filter((row) => row.purchaseId === from).reduce((sum, row) => sum + cents(row.hours), 0)
  if (task) {
    const expected = workspace.reports.filter((report) => report.taskId === task.id && available(report) > 0).map((report) => report.id).sort()
    if (JSON.stringify(expected) !== JSON.stringify([...unique].sort())) throw new ConflictException('Состав отчётов задачи изменился. Обновите список и повторите перенос')
    if (!expected.length && (task.purchaseId ?? null) !== from) throw new ConflictException('Привязка задачи изменилась. Обновите список')
  }
  const assignments = workspace.reports.map((report) => ({
    bitrixReportId: report.id,
    allocations: report.allocations.map((row) => ({ packageId: row.purchaseId, hours: row.hours })),
  }))
  // Snapshot all current placements: unrelated reports must not refill a freed package via FIFO.
  const used = new Map(packages.map((item) => [Number(item.id), item.consumptions.reduce((sum, row) => sum + cents(Number(row.hours)), 0)]))
  const limits = new Map(packages.map((item) => [Number(item.id), cents(Number(item.purchasedHours))]))
  const changed: TransferPlan['reports'] = []
  const actual: { reportId: string; hours: number }[] = []
  let unallocated = 0
  for (const item of request.items) {
    const report = workspace.reports.find((candidate) => candidate.id === item.reportId)
    if (!report || (task && report.taskId !== task.id)) throw new BadRequestException('Отчёт не относится к выбранному проекту или задаче')
    const quantity = cents(item.hours)
    if (quantity <= 0 || quantity > available(report)) throw new ConflictException('Часы отчёта изменились. Обновите список и повторите перенос')
    const assignment = assignments.find((candidate) => candidate.bitrixReportId === report.id)!
    if (from != null) {
      const row = assignment.allocations.find((candidate) => candidate.packageId === from)!
      row.hours = hours(cents(row.hours) - quantity)
      assignment.allocations = assignment.allocations.filter((row) => row.hours > 0)
      used.set(from, (used.get(from) ?? 0) - quantity)
    }
    const accepted = to == null ? 0 : Math.min(quantity, Math.max(0, (limits.get(to) ?? 0) - (used.get(to) ?? 0)))
    if (accepted > 0 && to != null) {
      const row = assignment.allocations.find((candidate) => candidate.packageId === to)
      if (row) row.hours = hours(cents(row.hours) + accepted)
      else assignment.allocations.push({ packageId: to, hours: hours(accepted) })
      used.set(to, (used.get(to) ?? 0) + accepted)
    }
    unallocated += quantity - accepted
    actual.push({ reportId: report.id, hours: to == null ? hours(quantity) : hours(accepted) })
    changed.push({ id: report.id, hours: report.hours, taskId: report.taskId, includeInPackage: assignment.allocations.some((row) => row.hours > 0) })
  }
  const canonical = { ...request, fromPurchaseId: from, toPurchaseId: to }
  const normalized = allocateProjectSupportHours(
    packages.map((item) => ({ id: Number(item.id), purchasedHours: Number(item.purchasedHours) })),
    [...workspace.reports].sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id)).map((report) => ({ id: Number(report.id), bitrixReportId: report.id, hours: report.hours })),
    assignments,
  )
  for (const assignment of assignments) assignment.allocations = normalized.filter((row) => String(row.reportId) === assignment.bitrixReportId).map(({ packageId, hours }) => ({ packageId, hours }))
  for (const report of changed) report.includeInPackage = assignments.find((row) => row.bitrixReportId === report.id)!.allocations.length > 0
  const normalizedUsed = new Map<number, number>()
  for (const row of normalized) normalizedUsed.set(row.packageId, (normalizedUsed.get(row.packageId) ?? 0) + cents(row.hours))
  const balances = packages.map((item) => {
    const bought = cents(Number(item.purchasedHours))
    const before = item.consumptions.reduce((sum, row) => sum + cents(Number(row.hours)), 0)
    const after = normalizedUsed.get(Number(item.id)) ?? 0
    return { id: Number(item.id), before: { purchasedHours: hours(bought), consumedHours: hours(before), remainingHours: hours(bought - before) }, after: { purchasedHours: hours(bought), consumedHours: hours(after), remainingHours: hours(bought - after) } }
  })
  const fingerprint = createHash('sha256').update(JSON.stringify({ request: canonical, reports: workspace.reports, tasks: workspace.tasks, packages: packages.map((item) => ({ id: item.id, hours: item.purchasedHours, date: item.purchaseDate, updatedAt: item.updatedAt })) })).digest('hex')
  return { projectId: workspace.projectId, request: canonical, assignments, reports: changed, preview: {
    fingerprint, movedHours: hours(actual.reduce((sum, item) => sum + cents(item.hours), 0)), unallocatedHours: hours(unallocated), items: actual, packages: balances,
    ...(task ? { taskTitle: task.title } : {}),
  } }
}
