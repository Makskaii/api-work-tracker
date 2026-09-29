import { BadRequestException, Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PdfService } from '../shared/pdf/pdf.service'
import {
  buildSupportPackageReportHtml,
  type SupportPackageReportData,
  type SupportPackageReportRow,
} from '../shared/pdf/support-package-report.template'
import type { SupportHoursPackage } from './entities/support-hours-package.entity'
import type { SupportHoursPackageReportSnapshot } from './support-hours-package-report.types'
import { SupportHoursPackagesService } from './support-hours-packages.service'

dayjs.extend(utc)
dayjs.extend(timezone)
const REPORT_TIMEZONE = 'Europe/Moscow'
const roundHours = (value: number) => Math.round(value * 100) / 100
const hoursValue = (value: unknown) => {
  const hours = Number(value)
  return Number.isFinite(hours) ? hours : 0
}

export function buildSupportPackageReportData(item: SupportHoursPackage & Partial<Pick<SupportHoursPackageReportSnapshot, 'taskContexts'>>, now = new Date()): SupportPackageReportData {
  const asOfDate = dayjs(now).tz(REPORT_TIMEZONE).format('YYYY-MM-DD')
  if (item.purchaseDate > asOfDate) throw new BadRequestException('Cannot generate a current report for a future package')
  const reports = new Map<string, { row: SupportPackageReportRow; taskId: string | null; taskTitle: string | null }>()
  const companyNames = new Set<string>()
  for (const consumption of item.consumptions) {
    // The snapshot should already be scoped to this package; keep this boundary explicit.
    if (String(consumption.packageId) !== String(item.id)) continue
    const report = consumption.report
    const reportDay = dayjs(report.reportDate)
    if (!reportDay.isValid()) continue
    const date = reportDay.tz(REPORT_TIMEZONE).format('YYYY-MM-DD')
    if (date > asOfDate) continue
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
  const reportsWithoutTask: SupportPackageReportRow[] = []
  const ordered = [...reports.values()].sort((first, second) => first.row.date.localeCompare(second.row.date) || first.row.id.localeCompare(second.row.id, undefined, { numeric: true }))
  for (const report of ordered) {
    if (!report.taskId) {
      reportsWithoutTask.push(report.row)
      continue
    }
    const task = tasks.get(report.taskId) ?? {
      id: report.taskId,
      title: report.taskTitle || `Задача №${report.taskId}`,
      hours: 0,
      status: 'unknown',
      soldHours: null,
      totalHours: 0,
      reports: [],
      otherPackageReports: [],
    }
    task.reports.push(report.row)
    task.hours = roundHours(task.hours + report.row.hours)
    task.totalHours = task.hours
    tasks.set(report.taskId, task)
  }
  for (const context of item.taskContexts ?? []) {
    const task = tasks.get(context.id)
    // A task appears only when the selected package has charges for it.
    if (!task) continue
    task.title = context.title || task.title
    task.status = context.status
    task.soldHours = context.soldHours
    const relatedReports = new Map(context.reports.map((report) => [report.bitrixReportId || String(report.id), report]))
    let totalHours = 0
    for (const [id, report] of relatedReports) {
      const reportDay = dayjs(report.reportDate)
      if (!reportDay.isValid()) continue
      const date = reportDay.tz(REPORT_TIMEZONE).format('YYYY-MM-DD')
      if (date > asOfDate) continue
      // Count a report once even when several packages pay portions of it.
      totalHours = roundHours(totalHours + hoursValue(report.hours))
      const allocations = new Map<number, number>()
      for (const allocation of report.consumptions ?? []) {
        const packageId = Number(allocation.packageId)
        const allocatedHours = hoursValue(allocation.hours)
        if (!Number.isSafeInteger(packageId) || packageId <= 0 || packageId === Number(item.id) || allocatedHours <= 0) continue
        allocations.set(packageId, roundHours((allocations.get(packageId) ?? 0) + allocatedHours))
      }
      for (const [packageId, allocatedHours] of allocations) {
        task.otherPackageReports.push({
          id, date, packageId, hours: allocatedHours,
          description: report.reportDescription?.trim() || report.reportTitle?.trim() || `Отчёт №${id}`,
        })
      }
    }
    task.totalHours = totalHours
    task.otherPackageReports.sort((first, second) => first.date.localeCompare(second.date) || first.id.localeCompare(second.id, undefined, { numeric: true }) || first.packageId - second.packageId)
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
    tasks: [...tasks.values()],
    reportsWithoutTask,
  }
}

@Injectable()
export class SupportHoursPackageReportService {
  constructor(
    private readonly packagesService: SupportHoursPackagesService,
    private readonly pdfService: PdfService,
  ) {}

  async generate(packageId: number) {
    const snapshot = await this.packagesService.getReportSnapshot(packageId)
    const data = buildSupportPackageReportData(snapshot)
    const [logo, watermark] = await Promise.all([
      this.readBrandImage('logo.jpg'),
      this.readBrandImage('watermark.jpg'),
    ])
    const html = buildSupportPackageReportHtml(data, watermark || undefined)
    const buffer = await this.pdfService.generatePdf(html, logo)
    return { buffer, filename: `support-package-${packageId}-${data.asOfDate}.pdf` }
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
