export type SupportPackageImpactBalance = {
  purchasedHours: number
  consumedHours: number
  remainingHours: number
  reportCount: number
}

export type SupportPackageImpact = {
  packageId: number
  projectId: number
  operation: 'update' | 'delete'
  fingerprint: string
  requiresConfirmation: boolean
  packages: {
    id: number
    purchaseDate: string
    before: SupportPackageImpactBalance | null
    after: SupportPackageImpactBalance | null
    affected: boolean
  }[]
  movedHours: number
  movedReportCount: number
  unallocatedHoursBefore: number
  unallocatedHoursAfter: number
}
