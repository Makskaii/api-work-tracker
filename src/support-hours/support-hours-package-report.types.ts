import type { SupportHoursPackage } from './entities/support-hours-package.entity'
import type { SupportHoursReport } from './entities/support-hours-report.entity'

export type SupportPackageTaskContext = {
  id: string
  title: string
  status: 'in_work' | 'completed' | 'cancelled' | 'unknown'
  soldHours: number | null
  reports: SupportHoursReport[]
  assignedToPackage?: boolean
}

export type SupportHoursPackageReportSnapshot = SupportHoursPackage & {
  taskContexts: SupportPackageTaskContext[]
}
