import { Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import dayjs from 'dayjs'
import fs from 'fs'
import path from 'path'
import {
  DailyReportCodes,
  EntityTypeIds,
  ProjectCodes,
  reportSelectFields,
  TASK_SELECT_FIELDS,
  TaskCodes,
} from 'src/constants/const'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { HtmlBuilderService } from 'src/shared/pdf/builder.service'
import { PdfService } from 'src/shared/pdf/pdf.service'
import { ClientProjects } from 'src/types/bitrix'
import {
  GroupedTasksWithTimeSpent,
  ReportProps,
  TaskWithResult,
  TaskWithTimeSpent,
} from 'src/types/reports'
import { TaskProps } from 'src/types/tasks'

type PreparedReport = {
  buffer: Buffer
  filename: string
  createdAt: number
}

type ReportCompany = {
  ID: string
  NAME: string
  [key: string]: unknown
}

type BitrixCompanyItem = {
  id?: string | number
  title?: string
  ID?: string | number
  TITLE?: string
  [key: string]: unknown
}

type TaskWithParentProject = TaskProps & {
  [TaskCodes.parentproject]?: string | number | null
}

@Injectable()
export class DocRecordsService {
  private readonly reports = new Map<string, PreparedReport>()
  private readonly ttlMs = 1000 * 60 * 10

  constructor(
    private readonly bitrixService: BitrixService,
    private readonly htmlService: HtmlBuilderService,
    private readonly pdfService: PdfService,
  ) {}

  private getImageBase64(relativePath: string) {
    const filePath = path.join(process.cwd(), relativePath)
    const file = fs.readFileSync(filePath)

    return `data:image/jpeg;base64,${file.toString('base64')}`
  }

  private parseSpentTime(value: unknown): number {
    if (typeof value === 'number') return value

    if (typeof value === 'string') {
      const normalized = value.replace(',', '.').trim()
      const parsed = Number(normalized)

      return Number.isFinite(parsed) ? parsed : 0
    }

    return 0
  }

  private parseNumber(value: unknown): number {
    if (typeof value === 'number') return value

    if (typeof value === 'string') {
      const normalized = value.replace(',', '.').trim()
      const parsed = Number(normalized)

      return Number.isFinite(parsed) ? parsed : 0
    }

    return 0
  }

  private roundTime(value: number): number {
    return Number(value.toFixed(2))
  }

  private getReportsWeeksCount(reports: ReportProps[]): number {
    const reportWeeks = reports
      .map((report) => dayjs(report.begindate))
      .filter((date) => date.isValid())
      .map((date) => date.startOf('week').format('YYYY-MM-DD'))

    return Math.max(new Set(reportWeeks).size, 1)
  }

  private formatBitrixDayStart(date: string) {
    return dayjs(date).startOf('day').format('YYYY-MM-DDTHH:mm:ssZ')
  }

  private formatBitrixDayEnd(date: string) {
    return dayjs(date).endOf('day').format('YYYY-MM-DDTHH:mm:ssZ')
  }

  private normalizeSprintDates(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .filter(
          (item): item is string =>
            typeof item === 'string' && item.trim() !== '',
        )
        .map((item) => dayjs(item).format('YYYY-MM-DD'))
    }

    if (typeof value === 'string' && value.trim() !== '') {
      return [dayjs(value).format('YYYY-MM-DD')]
    }

    return []
  }

  private isDateInRange(date: string, start: string, end: string) {
    const current = dayjs(date)
    const rangeStart = dayjs(start)
    const rangeEnd = dayjs(end)

    return (
      current.isSame(rangeStart, 'day') ||
      current.isSame(rangeEnd, 'day') ||
      (current.isAfter(rangeStart, 'day') && current.isBefore(rangeEnd, 'day'))
    )
  }

  private taskBelongsToPeriod(
    task: TaskWithTimeSpent,
    start: string,
    end: string,
  ) {
    const sprintDates = this.normalizeSprintDates(
      task[TaskCodes.sprintDateStart],
    )

    return sprintDates.some((date) => this.isDateInRange(date, start, end))
  }

  private calculateSpentForPeriod(
    tasks: TaskWithTimeSpent[],
    start: string,
    end: string,
  ) {
    return tasks
      .filter((task) => this.taskBelongsToPeriod(task, start, end))
      .reduce(
        (sum, task) => sum + this.parseNumber(task[TaskCodes.estimateTime]),
        0,
      )
  }

  private async getReportsMapByTaskIds(
    taskIds: string[],
    start: string,
    end: string,
  ) {
    const filterStart = this.formatBitrixDayStart(start)
    const filterEnd = this.formatBitrixDayEnd(end)

    const reportsResponses = await Promise.all(
      taskIds.map((taskId) =>
        this.bitrixService.listAllItems<ReportProps>({
          entityTypeId: EntityTypeIds.reports,
          select: reportSelectFields,
          filter: {
            [DailyReportCodes.parentId]: taskId,
            '>=begindate': filterStart,
            '<=begindate': filterEnd,
            stageId: 'DT1060_15:PREPARATION',
          },
        }),
      ),
    )

    return reportsResponses.reduce<Record<string, ReportProps[]>>(
      (acc, reports, index) => {
        acc[taskIds[index]] = Array.isArray(reports) ? reports : []
        return acc
      },
      {},
    )
  }

  private async getAllReportsMapByTaskIds(taskIds: string[]) {
    const reportsResponses = await Promise.all(
      taskIds.map((taskId) =>
        this.bitrixService.listAllItems<ReportProps>({
          entityTypeId: EntityTypeIds.reports,
          select: reportSelectFields,
          filter: {
            [DailyReportCodes.parentId]: taskId,
            stageId: 'DT1060_15:PREPARATION',
          },
        }),
      ),
    )

    return reportsResponses.reduce<Record<string, ReportProps[]>>(
      (acc, reports, index) => {
        acc[taskIds[index]] = Array.isArray(reports) ? reports : []
        return acc
      },
      {},
    )
  }

  private getReportParentTaskId(report: ReportProps): string | null {
    const taskId: unknown = report[DailyReportCodes.parentId]

    if (taskId === null || taskId === undefined || taskId === '') {
      return null
    }

    return String(taskId)
  }

  private getReportProjectId(report: ReportProps): string | null {
    const projectId: unknown =
      report[DailyReportCodes.parentproject] ?? report[DailyReportCodes.project]

    if (projectId === null || projectId === undefined || projectId === '') {
      return null
    }

    return String(projectId)
  }

  private groupReportsByParentTaskId(reports: ReportProps[]) {
    return reports.reduce<Record<string, ReportProps[]>>((acc, report) => {
      const taskId = this.getReportParentTaskId(report)

      if (!taskId) {
        return acc
      }

      if (!acc[taskId]) {
        acc[taskId] = []
      }

      acc[taskId].push(report)

      return acc
    }, {})
  }

  private getUniqueReportTaskIds(reports: ReportProps[]) {
    return Array.from(
      new Set(
        reports
          .map((report) => this.getReportParentTaskId(report))
          .filter((taskId): taskId is string => Boolean(taskId)),
      ),
    )
  }

  private chunkItems<T>(items: T[], size: number) {
    const chunks: T[][] = []

    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size))
    }

    return chunks
  }

  private async getTasksByIds(taskIds: string[]) {
    if (!taskIds.length) {
      return []
    }

    const taskChunks = this.chunkItems(taskIds, 50)
    const taskResponses = await Promise.all(
      taskChunks.map((ids) =>
        this.bitrixService.listAllItems<TaskWithParentProject>({
          entityTypeId: EntityTypeIds.tasks,
          select: TASK_SELECT_FIELDS,
          filter: {
            '@id': ids,
          },
        }),
      ),
    )

    return taskResponses.flat()
  }

  async prepareReport(projId: string, start: string, end: string) {
    this.clearExpiredReports()

    const periodStart = dayjs(start).subtract(7, 'day').format('YYYY-MM-DD')
    const periodEnd = end

    const tasks = await this.bitrixService.listAllItems<TaskProps>({
      entityTypeId: EntityTypeIds.tasks,
      select: TASK_SELECT_FIELDS,
      filter: {
        [`>=${TaskCodes.sprintDateStart}`]: periodStart,
        [`<=${TaskCodes.sprintDateStart}`]: periodEnd,
        stageId: 'DT1072_18:UC_6JNSDG',
        [TaskCodes.project]: projId,
      },
    })

    const normalizedTasks = Array.isArray(tasks) ? tasks : []
    const taskIds = normalizedTasks.map((task) => String(task.id))

    const reportsMap = await this.getReportsMapByTaskIds(
      taskIds,
      periodStart,
      periodEnd,
    )

    const tasksWithTimeSpent: TaskWithTimeSpent[] = normalizedTasks.map(
      (task) => {
        const taskId = String(task.id)
        const reports = reportsMap[taskId] ?? []

        const timeSpent = reports.reduce((sum, report) => {
          return sum + this.parseSpentTime(report[DailyReportCodes.timeSpent])
        }, 0)

        return {
          ...task,
          timeSpent,
          reports,
        }
      },
    )

    const groupedTasks = tasksWithTimeSpent.reduce<GroupedTasksWithTimeSpent>(
      (acc, task) => {
        const date = dayjs(task.movedTime).format('YYYY-MM-DD')

        if (!acc[date]) {
          acc[date] = []
        }

        acc[date].push(task)

        return acc
      },
      {},
    )

    const firstWeekStart = periodStart
    const firstWeekEnd = dayjs(periodStart).add(6, 'day').format('YYYY-MM-DD')

    const secondWeekStart = start
    const secondWeekEnd = end

    const firstWeekSpent = this.calculateSpentForPeriod(
      tasksWithTimeSpent,
      firstWeekStart,
      firstWeekEnd,
    )

    const secondWeekSpent = this.calculateSpentForPeriod(
      tasksWithTimeSpent,
      secondWeekStart,
      secondWeekEnd,
    )

    const logoBase64 = this.getImageBase64('public/docsLogo/logo.jpg')

    const html = this.htmlService.buildReportHtml({
      groupedTasks,
      periodText: `${dayjs(periodStart).format('DD.MM.YYYY')} - ${dayjs(periodEnd).format('DD.MM.YYYY')}`,
      summaryRows: [
        {
          label: `Сумма трудозатрат за неделю 1 (${dayjs(firstWeekStart).format('DD.MM')}-${dayjs(firstWeekEnd).format('DD.MM.YYYY')})`,
          value: `${firstWeekSpent} ч.`,
        },
        {
          label: `Сумма трудозатрат за неделю 2 (${dayjs(secondWeekStart).format('DD.MM')}-${dayjs(secondWeekEnd).format('DD.MM.YYYY')})`,
          value: `${secondWeekSpent} ч.`,
        },
      ],
      departmentTitle: 'отдела разработки',
      watermarkUrl: this.getImageBase64('public/docsLogo/watermark.jpg'),
    })

    const pdf = await this.pdfService.generatePdf(html, logoBase64)

    const reportId = randomUUID()
    const filename = `report_${projId}_${start}_${end}.pdf`

    this.reports.set(reportId, {
      buffer: pdf,
      filename,
      createdAt: Date.now(),
    })

    return {
      reportId,
      downloadUrl: `doc-records/report/${reportId}`,
    }
  }

  getPreparedReport(reportId: string) {
    this.clearExpiredReports()

    const report = this.reports.get(reportId)

    if (!report) {
      throw new NotFoundException('Report not found or expired')
    }

    return report
  }

  private clearExpiredReports() {
    const now = Date.now()

    for (const [reportId, report] of this.reports.entries()) {
      if (now - report.createdAt > this.ttlMs) {
        this.reports.delete(reportId)
      }
    }
  }

  private fetchProjectsByCompany(companyId: number): Promise<ClientProjects[]> {
    return this.bitrixService.listAllItems<ClientProjects>({
      entityTypeId: EntityTypeIds.projects,
      select: ['id', 'title'],
      filter: {
        [ProjectCodes.company]: companyId,
      },
    })
  }

  private async getReportCompany(companyId: string): Promise<ReportCompany> {
    const id = Number(companyId)

    if (!Number.isFinite(id) || id <= 0) {
      throw new NotFoundException(`Company with id ${companyId} not found`)
    }

    const company = await this.getCompanyById(id)

    if (!company) {
      throw new NotFoundException(`Company with id ${companyId} not found`)
    }

    const normalizedId = company.ID ?? company.id ?? companyId
    const normalizedName =
      company.TITLE ?? company.title ?? `Company ${String(normalizedId)}`

    return {
      ...company,
      ID: String(normalizedId),
      NAME: String(normalizedName),
    }
  }

  private async getCompanyById(id: number): Promise<BitrixCompanyItem | null> {
    try {
      return await this.bitrixService.getItem<BitrixCompanyItem>({
        entityTypeId: EntityTypeIds.companies,
        id,
      })
    } catch {
      return this.bitrixService.getCompany<BitrixCompanyItem>(id)
    }
  }

  private getConfirmedClientReports(
    companyId: number,
    periodFilterStart: string,
    periodFilterEnd: string,
    extraFilter: Record<string, unknown> = {},
  ): Promise<ReportProps[]> {
    const baseFilter = {
      ...extraFilter,
      '>=begindate': periodFilterStart,
      '<=begindate': periodFilterEnd,
      stageId: 'DT1060_15:PREPARATION',
    }

    return this.bitrixService.listAllItems<ReportProps>({
      entityTypeId: EntityTypeIds.reports,
      select: reportSelectFields,
      filter: {
        ...baseFilter,
        [DailyReportCodes.company]: companyId,
      },
    })
  }

  async prepareClientReport(clientId: string, start: string, end: string) {
    this.clearExpiredReports()

    const periodStart = dayjs(start).subtract(7, 'day').format('YYYY-MM-DD')
    const periodEnd = end
    const periodFilterStart = this.formatBitrixDayStart(periodStart)
    const periodFilterEnd = this.formatBitrixDayEnd(periodEnd)

    const company = await this.getReportCompany(clientId)
    const companyId = Number(company.ID)
    const projects = await this.fetchProjectsByCompany(companyId)

    const result: {
      project: ClientProjects
      tasks: TaskWithResult[]
    }[] = []

    const reports = await this.getConfirmedClientReports(
      companyId,
      periodFilterStart,
      periodFilterEnd,
    )

    const reportsMap = this.groupReportsByParentTaskId(reports)
    const reportTaskIds = this.getUniqueReportTaskIds(reports)
    const tasks = await this.getTasksByIds(reportTaskIds)
    const allReportsMap = await this.getAllReportsMapByTaskIds(reportTaskIds)
    const tasksByProjectId = new Map<string, TaskWithResult[]>()

    for (const task of tasks) {
      const taskId = String(task.id)
      const taskReports = reportsMap[taskId] ?? []

      const taskResult = taskReports.reduce((sum, report) => {
        return sum + ` ${report[DailyReportCodes.title]}`
      }, '')
      const timeSpent = taskReports.reduce((sum, report) => {
        return sum + this.parseSpentTime(report[DailyReportCodes.timeSpent])
      }, 0)

      const projectId =
        taskReports.map((report) => this.getReportProjectId(report)).find(Boolean) ??
        task[TaskCodes.parentproject]

      if (projectId === null || projectId === undefined || projectId === '') {
        continue
      }

      const projectKey = String(projectId)
      const projectTasks = tasksByProjectId.get(projectKey) ?? []

      projectTasks.push({
        ...task,
        result: taskResult,
        timeSpent,
        reports: taskReports,
        allReports: allReportsMap[taskId] ?? taskReports,
      })

      tasksByProjectId.set(projectKey, projectTasks)
    }

    for (const project of projects) {
      result.push({
        project,
        tasks: tasksByProjectId.get(String(project.id)) ?? [],
      })
    }

    const getReportDate = (report: ReportProps): string | null => {
      const value = report.begindate

      if (!value) return null

      const formatted = dayjs(value).format('YYYY-MM-DD')
      return formatted === 'Invalid Date' ? null : formatted
    }

    const calculateReportTime = (
      items: ReportProps[],
      start: string,
      end: string,
    ): number => {
      return items.reduce((sum, report) => {
        const reportDate = getReportDate(report)

        if (!reportDate || !isInRange(reportDate, start, end)) {
          return sum
        }

        return sum + this.parseSpentTime(report[DailyReportCodes.timeSpent])
      }, 0)
    }

    const splitReportsByWeeks = (
      items: ReportProps[],
      firstWeekStart: string,
      firstWeekEnd: string,
      secondWeekStart: string,
      secondWeekEnd: string,
    ) => {
      const firstWeekReports: ReportProps[] = []
      const secondWeekReports: ReportProps[] = []

      for (const report of items) {
        const reportDate = getReportDate(report)

        if (!reportDate) continue

        if (isInRange(reportDate, firstWeekStart, firstWeekEnd)) {
          firstWeekReports.push(report)
          continue
        }

        if (isInRange(reportDate, secondWeekStart, secondWeekEnd)) {
          secondWeekReports.push(report)
        }
      }

      return {
        firstWeekReports,
        secondWeekReports,
      }
    }

    const isInRange = (date: string, start: string, end: string) => {
      const d = dayjs(date)
      return (
        d.isSame(start, 'day') ||
        d.isSame(end, 'day') ||
        (d.isAfter(start, 'day') && d.isBefore(end, 'day'))
      )
    }

    const firstWeekStart = periodStart
    const firstWeekEnd = dayjs(start).subtract(1, 'day').format('YYYY-MM-DD')

    const secondWeekStart = start
    const secondWeekEnd = end

    const calculateAllocatedTaskTime = (task: TaskWithResult) => {
      const firstWeekReportedTime = calculateReportTime(
        task.reports,
        firstWeekStart,
        firstWeekEnd,
      )
      const secondWeekReportedTime = calculateReportTime(
        task.reports,
        secondWeekStart,
        secondWeekEnd,
      )
      const allTaskReports = task.allReports ?? task.reports
      const reportsTotal = allTaskReports.reduce((sum, report) => {
        return sum + this.parseSpentTime(report[DailyReportCodes.timeSpent])
      }, 0)
      const taskHours = this.parseNumber(task[TaskCodes.hours])

      if (
        taskHours <= 0 ||
        reportsTotal <= 0 ||
        task.stageId !== 'DT1072_18:UC_6JNSDG'
      ) {
        return {
          firstWeekTime: this.roundTime(firstWeekReportedTime),
          secondWeekTime: this.roundTime(secondWeekReportedTime),
        }
      }

      const hasFirstWeekReports = firstWeekReportedTime > 0
      const hasSecondWeekReports = secondWeekReportedTime > 0
      const activeWeeksCount = this.getReportsWeeksCount(allTaskReports)
      const additionPerWeek =
        activeWeeksCount > 0 ? (taskHours - reportsTotal) / activeWeeksCount : 0

      return {
        firstWeekTime: this.roundTime(
          firstWeekReportedTime +
            (hasFirstWeekReports ? additionPerWeek : 0),
        ),
        secondWeekTime: this.roundTime(
          secondWeekReportedTime +
            (hasSecondWeekReports ? additionPerWeek : 0),
        ),
      }
    }

    for (const item of result) {
      item.tasks = item.tasks.map((task) => {
        const allocatedTime = calculateAllocatedTaskTime(task)

        return {
          ...task,
          ...allocatedTime,
          timeSpent: this.roundTime(
            allocatedTime.firstWeekTime + allocatedTime.secondWeekTime,
          ),
        }
      })
    }

    const calculateTaskReportTime = (
      items: TaskWithResult[],
      start: string,
      end: string,
    ) => {
      return items.reduce((sum, task) => {
        if (start === firstWeekStart && end === firstWeekEnd) {
          return sum + (task.firstWeekTime ?? 0)
        }

        if (start === secondWeekStart && end === secondWeekEnd) {
          return sum + (task.secondWeekTime ?? 0)
        }

        return sum + calculateReportTime(task.reports, start, end)
      }, 0)
    }

    const allTasks = result.flatMap((item) => item.tasks ?? [])

    const InternalCommsReports = await this.getConfirmedClientReports(
      companyId,
      periodFilterStart,
      periodFilterEnd,
      {
        [DailyReportCodes.activityType]: '402',
      },
    )
    const ExternalCommsReports = await this.getConfirmedClientReports(
      companyId,
      periodFilterStart,
      periodFilterEnd,
      {
        [DailyReportCodes.activityType]: '417',
      },
    )

    const allReports = [...InternalCommsReports, ...ExternalCommsReports]

    const firstWeekTime = calculateReportTime(
      allReports,
      firstWeekStart,
      firstWeekEnd,
    )

    const secondWeekTime = calculateReportTime(
      allReports,
      secondWeekStart,
      secondWeekEnd,
    )

    const firstWeekTaskTime = calculateTaskReportTime(
      allTasks,
      firstWeekStart,
      firstWeekEnd,
    )

    const secondWeekTaskTime = calculateTaskReportTime(
      allTasks,
      secondWeekStart,
      secondWeekEnd,
    )

    const { firstWeekReports, secondWeekReports } = splitReportsByWeeks(
      allReports,
      firstWeekStart,
      firstWeekEnd,
      secondWeekStart,
      secondWeekEnd,
    )

    const totalEstimate =
      firstWeekTaskTime + secondWeekTaskTime + firstWeekTime + secondWeekTime

    const html = this.htmlService.buildClientReportHtml({
      client: company,
      projects: result,
      periodText: `${dayjs(periodStart).format('DD.MM.YYYY')} - ${dayjs(periodEnd).format('DD.MM.YYYY')}`,
      watermarkUrl: this.getImageBase64('public/docsLogo/watermark.jpg'),
      summaryRows: [
        {
          label: 'Общая оценка',
          value: `${totalEstimate} ч.`,
        },
        {
          label: `Неделя 1 (${dayjs(firstWeekStart).format('DD.MM')} - ${dayjs(firstWeekEnd).format('DD.MM')})`,
          value: `${firstWeekTaskTime} ч.`,
        },
        {
          label: `Неделя 2 (${dayjs(secondWeekStart).format('DD.MM')} - ${dayjs(secondWeekEnd).format('DD.MM')})`,
          value: `${secondWeekTaskTime} ч.`,
        },
      ],
      commsData: {
        firstWeekComms: {
          start: firstWeekStart,
          end: firstWeekEnd,
          externalComms: firstWeekReports.filter(
            (item) => String(item[DailyReportCodes.activityType]) === '417',
          ),
          internalComms: firstWeekReports.filter(
            (item) => String(item[DailyReportCodes.activityType]) === '402',
          ),
          spent: firstWeekTime,
        },
        secondWeekComms: {
          start: secondWeekStart,
          end: secondWeekEnd,
          externalComms: secondWeekReports.filter(
            (item) => String(item[DailyReportCodes.activityType]) === '417',
          ),
          internalComms: secondWeekReports.filter(
            (item) => String(item[DailyReportCodes.activityType]) === '402',
          ),
          spent: secondWeekTime,
        },
      },
    })

    const pdf = await this.pdfService.generatePdf(
      html,
      this.getImageBase64('public/docsLogo/logo.jpg'),
    )

    const reportId = randomUUID()

    this.reports.set(reportId, {
      buffer: pdf,
      filename: `client_report_${clientId}.pdf`,
      createdAt: Date.now(),
    })

    return {
      reportId,
      downloadUrl: `doc-records/report/${reportId}`,
      fWReports: firstWeekReports,
      sWReports: secondWeekReports,
      result,
    }
  }
}
