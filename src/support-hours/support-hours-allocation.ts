export type AllocatablePackage = {
  id: number
  purchasedHours: number
  consumedHours: number
}

export type SupportHoursAllocation = {
  packageId: number
  hours: number
}

export const allocateSupportHours = (
  packages: AllocatablePackage[],
  reportHours: number,
): SupportHoursAllocation[] => {
  if (reportHours <= 0 || !Number.isFinite(reportHours)) {
    return []
  }

  let remainingHours = reportHours
  const allocations: SupportHoursAllocation[] = []

  for (const item of packages) {
    if (remainingHours <= 0) break

    const availableHours = Math.max(0, item.purchasedHours - item.consumedHours)
    const hours = Math.min(availableHours, remainingHours)

    if (hours > 0) {
      allocations.push({ packageId: item.id, hours })
      remainingHours -= hours
    }
  }

  if (remainingHours > 0 && packages.length) {
    const lastPackageId = packages.at(-1)!.id
    const lastAllocation = allocations.at(-1)

    if (lastAllocation?.packageId === lastPackageId) {
      lastAllocation.hours += remainingHours
    } else {
      allocations.push({ packageId: lastPackageId, hours: remainingHours })
    }
  }

  return allocations
}

export type ProjectAllocationPackage = { id: number; purchasedHours: number }
export type ProjectAllocationReport = { id: number; bitrixReportId: string; bitrixTaskId?: string | null; hours: number }
export type ProjectReportAssignment = { bitrixReportId: string; allocations: { packageId: number; hours: number }[] }
export type ProjectTaskAssignment = { bitrixTaskId: string; packageId: number | null }
export type ProjectSupportHoursAllocation = { reportId: number; packageId: number; hours: number }

const hundredths = (value: number): number => {
  const rounded = Math.round(Number(value) * 100)
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : 0
}

/**
 * Packages and reports arrive in FIFO order. A manual row (even []) opts that
 * report out of FIFO; otherwise a task binding controls its future reports.
 * Only untouched automatic reports retain the legacy last-package overrun.
 */
export function allocateProjectSupportHours(
  packages: readonly ProjectAllocationPackage[],
  reports: readonly ProjectAllocationReport[],
  assignments: readonly ProjectReportAssignment[] = [],
  taskAssignments: readonly ProjectTaskAssignment[] = [],
): ProjectSupportHoursAllocation[] {
  const byPackage = new Map(packages.map((item) => [Number(item.id), hundredths(item.purchasedHours)]))
  const consumed = new Map<number, number>()
  const reportRules = new Map(assignments.map((item) => [String(item.bitrixReportId), item.allocations]))
  const taskRules = new Map(taskAssignments.map((item) => [String(item.bitrixTaskId), item.packageId]))
  const rows = new Map<number, Map<number, number>>()
  const add = (reportId: number, packageId: number, hours: number) => {
    if (hours <= 0) return
    consumed.set(packageId, (consumed.get(packageId) ?? 0) + hours)
    const reportRows = rows.get(reportId) ?? new Map<number, number>()
    reportRows.set(packageId, (reportRows.get(packageId) ?? 0) + hours)
    rows.set(reportId, reportRows)
  }
  const capped = (report: ProjectAllocationReport, allocations: readonly { packageId: number; hours: number }[]) => {
    let remaining = hundredths(report.hours)
    for (const allocation of allocations) {
      const packageId = Number(allocation.packageId)
      if (!byPackage.has(packageId)) continue
      const available = Math.max(0, byPackage.get(packageId)! - (consumed.get(packageId) ?? 0))
      const hours = Math.min(remaining, hundredths(allocation.hours), available)
      add(Number(report.id), packageId, hours)
      remaining -= hours
      if (remaining <= 0) break
    }
  }

  // Explicit report decisions reserve capacity before inherited/automatic work.
  for (const report of reports) {
    const rule = reportRules.get(String(report.bitrixReportId))
    if (rule !== undefined) {
      if (!Array.isArray(rule)) throw new Error('Invalid persisted support-hours allocation')
      capped(report, rule)
    }
  }
  for (const report of reports) {
    if (reportRules.has(String(report.bitrixReportId)) || !report.bitrixTaskId || !taskRules.has(String(report.bitrixTaskId))) continue
    const packageId = taskRules.get(String(report.bitrixTaskId))
    if (packageId != null) capped(report, [{ packageId, hours: report.hours }])
  }
  for (const report of reports) {
    if (reportRules.has(String(report.bitrixReportId)) || (report.bitrixTaskId && taskRules.has(String(report.bitrixTaskId)))) continue
    let remaining = hundredths(report.hours)
    for (const item of packages) {
      const packageId = Number(item.id)
      const available = Math.max(0, byPackage.get(packageId)! - (consumed.get(packageId) ?? 0))
      const hours = Math.min(remaining, available)
      add(Number(report.id), packageId, hours)
      remaining -= hours
      if (remaining <= 0) break
    }
    if (remaining > 0 && packages.length) add(Number(report.id), Number(packages.at(-1)!.id), remaining)
  }
  // Stable output follows caller-provided chronology, regardless of rule phase.
  return reports.flatMap((report) => packages.flatMap((item) => {
    const hours = rows.get(Number(report.id))?.get(Number(item.id)) ?? 0
    return hours > 0 ? [{ reportId: Number(report.id), packageId: Number(item.id), hours: hours / 100 }] : []
  }))
}
