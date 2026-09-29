import { BadGatewayException } from '@nestjs/common'
import { DailyReportCodes } from '../constants/const'
import type { ReportProject } from '../project-reports/entities/project-report-project.entity'
import type { SupportHoursPackage } from './entities/support-hours-package.entity'

export type SupportWorkspaceTask = { id: string; title: string; stageId: string | null }
export type SupportWorkspaceReport = {
  id: string
  taskId: string | null
  taskTitle: string | null
  responsibleName: string | null
  date: string
  hours: number
  title: string | null
  description: string | null
  includeInPackage: boolean
  allocations: { purchaseId: number; purchaseDate: string; hours: number }[]
  allocatedHours: number
  unallocatedHours: number
}
export type SupportProjectWorkspace = {
  projectId: number
  reports: SupportWorkspaceReport[]
  tasks: SupportWorkspaceTask[]
  packageGroup: {
    project: ReportProject
    purchasedHours: number
    consumedHours: number
    remainingHours: number
    state: string
    lastChargeAt: Date | null
    packages: (SupportHoursPackage & { remainingHours: number })[]
  }
}

export const workspaceId = (value: unknown): string => {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new BadGatewayException('Битрикс вернул некорректный идентификатор')
  }
  return String(Number(value))
}
const optionalId = (value: unknown): string | null => value == null || value === '' || value === 0 || value === '0' ? null : workspaceId(value)
const text = (value: unknown): string | null => {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new BadGatewayException('Битрикс вернул некорректный текст отчёта')
  return value.trim() || null
}
const date = (value: unknown): Date => {
  if (typeof value !== 'string' || !value.trim() || !Number.isFinite(new Date(value).getTime())) throw new BadGatewayException('Битрикс вернул некорректную дату отчёта')
  return new Date(value)
}

// Validate the whole source snapshot before changing cached billing data.
export function parseWorkspaceReport(value: Record<string, unknown>) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !Object.hasOwn(value, DailyReportCodes.includeInPackage) || !Object.hasOwn(value, DailyReportCodes.timeSpent) ||
    !Object.hasOwn(value, DailyReportCodes.parentproject)) throw new BadGatewayException('Битрикс вернул неполные данные отчёта')
  const flag = value[DailyReportCodes.includeInPackage]
  if (![true, false, 1, 0, '1', '0', 'Y', 'N', '', null].includes(flag as string)) throw new BadGatewayException('Битрикс вернул некорректный признак учёта отчёта')
  const rawHours = value[DailyReportCodes.timeSpent]
  if (rawHours != null && typeof rawHours !== 'string' && typeof rawHours !== 'number') throw new BadGatewayException('Битрикс вернул некорректные часы отчёта')
  const hours = Number(String(rawHours ?? '').replace(',', '.'))
  if (!Number.isFinite(hours) || hours < 0 || hours >= 100_000_000) throw new BadGatewayException('Битрикс вернул некорректные часы отчёта')
  const reportDate = date(value.begindate || value.createdTime)
  return {
    id: workspaceId(value.id), projectId: optionalId(value[DailyReportCodes.parentproject]),
    taskId: optionalId(value[DailyReportCodes.parentId]), responsibleId: optionalId(value.assignedById),
    companyId: optionalId(value[DailyReportCodes.company]), activityId: optionalId(value[DailyReportCodes.activityType]),
    title: text(value.title), description: text(value[DailyReportCodes.title]),
    hours: Math.round(hours * 100) / 100, includeInPackage: [true, 1, '1', 'Y'].includes(flag as string),
    reportDate, lastActivityAt: date(value.lastActivityTime || value.createdTime || value.begindate),
  }
}
