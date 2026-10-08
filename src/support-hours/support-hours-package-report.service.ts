import { BadRequestException, Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClientsService, type CompanyReportPresentation } from '../clients/clients.service'
import { ClientTaskStatuses, TaskCodes } from '../constants/const'
import { PdfService } from '../shared/pdf/pdf.service'
import {
  buildSupportPackageReportHtml,
  type SupportPackageReportData,
  type SupportPackageReportRow,
} from '../shared/pdf/support-package-report.template'
import type { SupportHoursPackage } from './entities/support-hours-package.entity'
import type { SupportHoursPackageReportSnapshot } from './support-hours-package-report.types'
import { SupportHoursPackagesService } from './support-hours-packages.service'
import { SupportClientWorkReaderService, type SupportClientWork } from './support-client-work-reader.service'
import { validateSupportPackageReportScope, type SupportPackageReportScope } from './dto/download-support-package-report.dto'

dayjs.extend(utc)
dayjs.extend(timezone)
const REPORT_TIMEZONE = 'Europe/Moscow'
const roundHours = (value: number) => Math.round(value * 100) / 100
const hoursValue = (value: unknown) => {
  const hours = Number(value)
  return Number.isFinite(hours) ? hours : 0
}

/** Distribute an agreed client volume without changing actual work or package charges. */
export function distributeSupportClientReportHours(rows: readonly SupportPackageReportRow[], agreedHours: number | null): SupportPackageReportRow[] {
  if (agreedHours === null) return rows.map((row) => ({ ...row }))
  const cents = Math.round(agreedHours * 100)
  if (!Number.isSafeInteger(cents) || cents < 0) throw new BadRequestException('Некорректный объём часов задачи')
  // Prefer readable tenths, retaining hundredths when the agreed total requires them.
  const quantumCents = BigInt(cents % 10 === 0 ? 10 : 1)
  const targetUnits = BigInt(cents) / quantumCents
  const weighted = rows.map((row, index) => {
    const weight = Math.round(hoursValue(row.hours) * 100)
    if (!Number.isSafeInteger(weight) || weight < 0) throw new BadRequestException('Некорректный объём часов работы')
    return { row, index, weight: BigInt(weight), units: 0n, remainder: 0n }
  })
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0n)
  if (totalWeight === 0n) return weighted.map(({ row }) => ({ ...row, hours: 0 }))
  for (const row of weighted) {
    const share = targetUnits * row.weight
    row.units = share / totalWeight
    row.remainder = share % totalWeight
  }
  let remaining = targetUnits - weighted.reduce((sum, row) => sum + row.units, 0n)
  const largestRemainders = [...weighted].sort((first, second) => {
    if (first.remainder !== second.remainder) return first.remainder > second.remainder ? -1 : 1
    return first.row.date.localeCompare(second.row.date)
      || first.row.id.localeCompare(second.row.id, undefined, { numeric: true })
      || first.index - second.index
  })
  for (const row of largestRemainders) {
    if (remaining === 0n) break
    row.units += 1n
    remaining -= 1n
  }
  return weighted.map(({ row, units }) => ({ ...row, hours: Number(units * quantumCents) / 100 }))
}

export function buildSupportPackageReportData(item: SupportHoursPackage & Partial<Pick<SupportHoursPackageReportSnapshot, 'taskContexts'>>, now = new Date(), requestedScope?: SupportPackageReportScope): SupportPackageReportData {
  const asOfDate = dayjs(now).tz(REPORT_TIMEZONE).format('YYYY-MM-DD')
  const scope = validateSupportPackageReportScope(requestedScope, now)
  const balanceDate = scope?.dateTo ?? asOfDate
  if (item.purchaseDate > asOfDate) throw new BadRequestException('Cannot generate a current report for a future package')
  if (scope && scope.dateTo < item.purchaseDate) throw new BadRequestException('Период отчёта заканчивается до даты покупки пакета')
  const reports = new Map<string, { row: SupportPackageReportRow; taskId: string | null; taskTitle: string | null }>()
  const companyNames = new Set<string>()
  for (const consumption of item.consumptions) {
    // The snapshot should already be scoped to this package; keep this boundary explicit.
    if (String(consumption.packageId) !== String(item.id)) continue
    const report = consumption.report
    const reportDay = dayjs(report.reportDate)
    if (!reportDay.isValid()) continue
    const date = reportDay.tz(REPORT_TIMEZONE).format('YYYY-MM-DD')
    if (date > balanceDate) continue
    const hours = hoursValue(consumption.hours)
    if (hours <= 0) continue
    const id = report.bitrixReportId || String(report.id)
    const existing = reports.get(id)
    if (existing) {
      existing.row.hours = roundHours(existing.row.hours + hours)
      continue
    }
    const taskId = report.bitrixTaskId && /^\d+$/.test(report.bitrixTaskId) && Number(report.bitrixTaskId) > 0
      ? report.bitrixTaskId
      : null
    reports.set(id, {
      row: {
        id,
        date,
        description: report.reportDescription?.trim() || report.reportTitle?.trim() || `Отчёт №${id}`,
        hours: roundHours(hours),
      },
      taskId,
      taskTitle: report.taskTitle?.trim() || null,
    })
    const companyName = report.companyName?.trim()
    if (companyName) companyNames.add(companyName)
  }
  const tasks = new Map<string, SupportPackageReportData['tasks'][number]>()
  const ensureTask = (id: string, title: string | null) => {
    const task: SupportPackageReportData['tasks'][number] = tasks.get(id) ?? {
      id,
      title: title || `Задача №${id}`,
      hours: 0,
      status: 'unknown',
      soldHours: null,
      totalHours: 0,
      reports: [],
      clientReports: [],
      otherPackageReports: [],
      unallocatedReports: [],
    }
    tasks.set(id, task)
    return task
  }
  const reportsWithoutTask: SupportPackageReportRow[] = []
  const ordered = [...reports.values()].sort((first, second) => first.row.date.localeCompare(second.row.date) || first.row.id.localeCompare(second.row.id, undefined, { numeric: true }))
  const selected = scope ? ordered.filter((report) => report.row.date >= scope.dateFrom) : ordered
  for (const report of selected) {
    if (!report.taskId) {
      reportsWithoutTask.push(report.row)
      continue
    }
    const task = ensureTask(report.taskId, report.taskTitle)
    task.reports.push(report.row)
    task.hours = roundHours(task.hours + report.row.hours)
    task.totalHours = task.hours
  }
  for (const context of item.taskContexts ?? []) {
    const task = tasks.get(context.id) ?? (!scope && context.assignedToPackage ? ensureTask(context.id, context.title) : null)
    // Full-package reports retain task-only assignments. A period selects tasks by actual work dates.
    if (!task) continue
    task.title = context.title || task.title
    task.status = context.status
    task.soldHours = context.soldHours
    const relatedReports = new Map(context.reports.map((report) => [report.bitrixReportId || String(report.id), report]))
    const wholeTaskRows: SupportPackageReportRow[] = []
    let totalHours = 0
    for (const [id, report] of relatedReports) {
      const reportDay = dayjs(report.reportDate)
      if (!reportDay.isValid()) continue
      const date = reportDay.tz(REPORT_TIMEZONE).format('YYYY-MM-DD')
      if (date > asOfDate) continue
      const actualHours = hoursValue(report.hours)
      if (actualHours <= 0) continue
      wholeTaskRows.push({
        id, date, hours: roundHours(actualHours),
        description: report.reportDescription?.trim() || report.reportTitle?.trim() || `Отчёт №${id}`,
      })
      // Count a report once even when several packages pay portions of it.
      totalHours = roundHours(totalHours + actualHours)
      const allocations = new Map<number, number>()
      let allocatedTotal = 0
      for (const allocation of report.consumptions ?? []) {
        const packageId = Number(allocation.packageId)
        const allocatedHours = hoursValue(allocation.hours)
        if (!Number.isSafeInteger(packageId) || packageId <= 0 || allocatedHours <= 0) continue
        allocatedTotal += allocatedHours
        if (packageId === Number(item.id)) continue
        allocations.set(packageId, roundHours((allocations.get(packageId) ?? 0) + allocatedHours))
      }
      const unallocatedHours = roundHours(Math.max(0, hoursValue(report.hours) - allocatedTotal))
      if (unallocatedHours > 0) task.unallocatedReports!.push({
        id, date, hours: unallocatedHours,
        description: report.reportDescription?.trim() || report.reportTitle?.trim() || `Отчёт №${id}`,
      })
      for (const [packageId, allocatedHours] of allocations) {
        task.otherPackageReports.push({
          id, date, packageId, hours: allocatedHours,
          description: report.reportDescription?.trim() || report.reportTitle?.trim() || `Отчёт №${id}`,
        })
      }
    }
    task.totalHours = totalHours
    wholeTaskRows.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id, undefined, { numeric: true }))
    // A touched task is shown whole, even when its work lies outside the selected period or package.
    task.clientReports = context.status === 'completed'
      ? distributeSupportClientReportHours(wholeTaskRows, context.soldHours)
      : []
    task.otherPackageReports.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id, undefined, { numeric: true }) || first.packageId - second.packageId)
    task.unallocatedReports!.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id, undefined, { numeric: true }))
  }
  const spentHours = roundHours(ordered.reduce((sum, report) => sum + report.row.hours, 0))
  const purchasedHours = hoursValue(item.purchasedHours)
  return {
    projectTitle: item.project.title,
    clientName: item.project.clientCompany?.trim() || (companyNames.size === 1 ? [...companyNames][0] : null),
    packageId: item.id,
    purchaseDate: item.purchaseDate,
    asOfDate,
    purchasedHours,
    spentHours,
    remainingHours: roundHours(purchasedHours - spentHours),
    ...(scope ? {
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
      periodSpentHours: roundHours(selected.reduce((sum, report) => sum + report.row.hours, 0)),
    } : {}),
    tasks: [...tasks.values()],
    reportsWithoutTask,
  }
}

/** Use the cabinet's company task list and totals, independently of package charging. */
export function buildSupportCabinetReportData(
  context: { packageId: number; projectTitle: string; companyTitle: string; purchaseDate: string },
  presentation: CompanyReportPresentation,
  works: readonly SupportClientWork[],
  now = new Date(),
  requestedScope?: SupportPackageReportScope,
): SupportPackageReportData {
  const scope = validateSupportPackageReportScope(requestedScope, now)
  if (presentation.purchasedHours === null) {
    throw new BadRequestException('Укажите купленные часы в кабинете клиента перед формированием отчёта')
  }
  const rowsByTask = new Map<string, SupportPackageReportRow[]>()
  const uniqueReports = new Set<string>()
  const today = dayjs(now).tz(REPORT_TIMEZONE).format('YYYY-MM-DD')
  for (const { taskId, row } of works) {
    if (row.date > today || uniqueReports.has(row.id)) continue
    uniqueReports.add(row.id)
    const rows = rowsByTask.get(taskId) ?? []
    rows.push({ ...row })
    rowsByTask.set(taskId, rows)
  }
  const tasks = presentation.tasks.flatMap((task) => {
    const reports = (rowsByTask.get(task.id) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, undefined, { numeric: true }))
    if (scope && !reports.some((row) => row.date >= scope.dateFrom && row.date <= scope.dateTo)) return []
    const rawSold = task[TaskCodes.hours]
    const parsedSold = typeof rawSold === 'string' ? Number(rawSold.trim().replace(',', '.')) : rawSold
    const soldHours = rawSold == null || rawSold === '' || typeof parsedSold !== 'number' || !Number.isFinite(parsedSold) ? null : roundHours(parsedSold)
    const completed = task.status === ClientTaskStatuses.done
    return [{
      id: task.id, title: task.title, status: completed ? 'completed' as const : 'in_work' as const,
      soldHours, hours: soldHours ?? 0,
      totalHours: roundHours(reports.reduce((sum, row) => sum + row.hours, 0)),
      reports,
      clientReports: completed ? distributeSupportClientReportHours(reports, soldHours) : [],
      otherPackageReports: [],
    }]
  })
  const completedIds = new Set(presentation.completedTaskIds)
  return {
    reportBasis: 'client_cabinet',
    projectTitle: context.projectTitle, clientName: context.companyTitle,
    packageId: context.packageId, purchaseDate: context.purchaseDate, asOfDate: today,
    purchasedHours: presentation.purchasedHours, spentHours: presentation.completedHours,
    remainingHours: roundHours(presentation.purchasedHours - presentation.completedHours),
    completedTaskCount: presentation.completedTaskCount,
    ...(scope ? {
      dateFrom: scope.dateFrom, dateTo: scope.dateTo,
      periodSpentHours: roundHours(tasks.filter((task) => completedIds.has(task.id)).reduce((sum, task) => sum + (task.soldHours ?? 0), 0)),
    } : {}),
    tasks, reportsWithoutTask: [],
  }
}

@Injectable()
export class SupportHoursPackageReportService {
  constructor(
    private readonly packagesService: SupportHoursPackagesService,
    private readonly pdfService: PdfService,
    private readonly clientsService: ClientsService,
    private readonly workReader: SupportClientWorkReaderService,
  ) {}

  async generate(packageId: number, requestedScope?: SupportPackageReportScope) {
    const now = new Date()
    const scope = validateSupportPackageReportScope(requestedScope, now)
    const context = await this.packagesService.getClientReportContext(packageId)
    const presentation = await this.clientsService.getCompanyReportPresentation(context.companyId, now)
    const works = await this.workReader.read(presentation.tasks.map((task) => task.id), now)
    const data = buildSupportCabinetReportData(context, presentation, works, now, scope)
    const [logo, watermark] = await Promise.all([
      this.readBrandImage('logo.jpg'),
      this.readBrandImage('watermark.jpg'),
    ])
    const html = buildSupportPackageReportHtml(data, watermark || undefined)
    const buffer = await this.pdfService.generatePdf(html, logo)
    const suffix = scope ? `${scope.dateFrom}-${scope.dateTo}` : data.asOfDate
    return { buffer, filename: `support-package-${packageId}-${suffix}.pdf`, snapshot: {
      projectId: context.projectId, projectTitle: data.projectTitle, clientName: data.clientName,
      packageId: data.packageId, purchasedHours: data.purchasedHours, spentHours: data.spentHours, remainingHours: data.remainingHours,
    } }
  }

  private async readBrandImage(filename: 'logo.jpg' | 'watermark.jpg'): Promise<string> {
    try {
      const image = await readFile(join(process.cwd(), 'public', 'docsLogo', filename))
      return `data:image/jpeg;base64,${image.toString('base64')}`
    } catch {
      return ''
    }
  }
}
