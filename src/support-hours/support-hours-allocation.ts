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
