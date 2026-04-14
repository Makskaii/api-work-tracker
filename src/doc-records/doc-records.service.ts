import { Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import dayjs from 'dayjs'
import fs from 'fs'
import path from 'path'
import {
  ClientsCodes,
  DailyReportCodes,
  EntityTypeIds,
  TASK_SELECT_FIELDS,
  TaskCodes,
} from 'src/constants/const'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { HtmlBuilderService } from 'src/shared/pdf/builder.service'
import { PdfService } from 'src/shared/pdf/pdf.service'
import {
  BitrixClientProjects,
  BitrixClients,
  ClientProjects,
} from 'src/types/bitrix'
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

export type ProjectFromList = {
  id: string
  name: string
  projectId: string
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
    const reportSelectFields = [
      'id',
      'title',
      'begindate',
      DailyReportCodes.title,
      DailyReportCodes.timeSpent,
      DailyReportCodes.project,
      DailyReportCodes.taskId,
      DailyReportCodes.activityType,
      'assignedById',
      'createdTime',
      'lastActivityTime',
      `parentId${EntityTypeIds.tasks}`,
    ]

    const reportsResponses = await Promise.all(
      taskIds.map((taskId) =>
        this.bitrixService.listItems<ReportProps>({
          entityTypeId: EntityTypeIds.reports,
          select: reportSelectFields,
          filter: {
            [DailyReportCodes.parentId]: taskId,
            '>=begindate': start,
            '<=begindate': end,
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

  async prepareReport(projId: string, start: string, end: string) {
    this.clearExpiredReports()

    const periodStart = dayjs(start).subtract(7, 'day').format('YYYY-MM-DD')
    const periodEnd = end

    const tasks = await this.bitrixService.listItems<TaskProps>({
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

  private getSinglePropertyValue = (
    property?: Record<string, string> | null,
  ): string => {
    if (!property) return ''

    const value = Object.values(property)[0]

    return value ? String(value) : ''
  }
  async fetchProjectsByClient(
    clients: BitrixClients[],
    projectsFromList: ProjectFromList[],
  ) {
    if (!clients) return []

    try {
      const response = await Promise.all(
        clients.map(async (client) => {
          const projects = await this.bitrixService.listItems<ClientProjects>({
            entityTypeId: EntityTypeIds.projects,
            filter: {
              [ClientsCodes.client]: client.ID,
            },
          })

          const projectsWithRealId = (projects ?? []).map((project) => {
            const projectTitle = String(project.title ?? '')
              .trim()
              .toLowerCase()

            const matchedProject = projectsFromList.find(
              (listProject) =>
                listProject.name.trim().toLowerCase() === projectTitle,
            )

            return {
              ...project,
              projectId: matchedProject?.id ?? '',
            }
          })

          return {
            ...client,
            projects: projectsWithRealId,
          }
        }),
      )

      return response
    } catch (error) {
      console.log(error)
      return []
    }
  }

  private mapProjectsFromList = (
    items: BitrixClientProjects[],
  ): ProjectFromList[] => {
    return items
      .map((element) => ({
        id: String(element.ID),
        name: String(element.NAME ?? ''),
        projectId: this.getSinglePropertyValue(element.PROPERTY_87),
      }))
      .filter((item) => item.projectId)
  }

  async prepareClientReport(clientId: string, start: string, end: string) {
    this.clearExpiredReports()

    const periodStart = dayjs(start).subtract(7, 'day').format('YYYY-MM-DD')
    const periodEnd = end

    const clients = await this.bitrixService.getClients()
    const projectList = await this.bitrixService.getClientsProjects()

    const normalizedProjects = this.mapProjectsFromList(projectList)

    const data = await this.fetchProjectsByClient(clients, normalizedProjects)

    const client = data.find((c) => String(c.ID) === String(clientId))

    if (!client) {
      throw new NotFoundException(
        `Client with id ${clientId} not found or has no projects`,
      )
    }

    const result: {
      project: ClientProjects
      tasks: TaskWithResult[]
    }[] = []

    for (const project of client.projects) {
      const tasks = await this.bitrixService.listItems<TaskProps>({
        entityTypeId: EntityTypeIds.tasks,
        select: TASK_SELECT_FIELDS,
        filter: {
          [`>=${TaskCodes.sprintDateStart}`]: periodStart,
          [`<=${TaskCodes.sprintDateStart}`]: periodEnd,
          stageId: 'DT1072_18:UC_6JNSDG',
          [TaskCodes.project]: project.projectId,
        },
      })

      const normalizedTasks = Array.isArray(tasks) ? tasks : []
      const taskIds = normalizedTasks.map((task) => String(task.id))

      const reportsMap = await this.getReportsMapByTaskIds(
        taskIds,
        periodStart,
        periodEnd,
      )

      const tasksWithResult: TaskWithResult[] = normalizedTasks.map((task) => {
        const taskId = String(task.id)
        const reports = reportsMap[taskId] ?? []

        const result = reports.reduce((sum, report) => {
          return sum + ` ${report[DailyReportCodes.title]}`
        }, '')

        return {
          ...task,
          result,
          reports,
        }
      })

      result.push({
        project,
        tasks: tasksWithResult,
      })
    }

    const parseEstimate = (value: unknown): number => {
      if (typeof value === 'number') return value

      if (typeof value === 'string') {
        const normalized = value.replace(',', '.').trim()
        const parsed = Number(normalized)
        return Number.isFinite(parsed) ? parsed : 0
      }

      return 0
    }

    const isInRange = (date: string, start: string, end: string) => {
      const d = dayjs(date)
      return (
        d.isSame(start, 'day') ||
        d.isSame(end, 'day') ||
        (d.isAfter(start, 'day') && d.isBefore(end, 'day'))
      )
    }

    const getSprintDates = (task: TaskProps): string[] => {
      const value = task[TaskCodes.sprintDateStart]

      if (Array.isArray(value)) {
        return value.map((d) => dayjs(d).format('YYYY-MM-DD'))
      }

      if (typeof value === 'string') {
        return [dayjs(value).format('YYYY-MM-DD')]
      }

      return []
    }

    if (!client) {
      throw new NotFoundException('Client not found')
    }

    const firstWeekStart = periodStart
    const firstWeekEnd = dayjs(periodStart).add(6, 'day').format('YYYY-MM-DD')

    const secondWeekStart = start
    const secondWeekEnd = end

    const calculateEstimate = (
      tasks: TaskProps[],
      start: string,
      end: string,
    ) => {
      return tasks.reduce((sum, task) => {
        const dates = getSprintDates(task)

        const inPeriod = dates.some((date) => isInRange(date, start, end))

        if (!inPeriod) return sum

        return sum + parseEstimate(task[TaskCodes.estimateTime])
      }, 0)
    }

    const allTasks = result.flatMap((item) => item.tasks ?? [])

    const firstWeekEstimate = calculateEstimate(
      allTasks,
      firstWeekStart,
      firstWeekEnd,
    )

    const secondWeekEstimate = calculateEstimate(
      allTasks,
      secondWeekStart,
      secondWeekEnd,
    )

    const totalEstimate = firstWeekEstimate + secondWeekEstimate

    const html = this.htmlService.buildClientReportHtml({
      client,
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
          value: `${firstWeekEstimate} ч.`,
        },
        {
          label: `Неделя 2 (${dayjs(secondWeekStart).format('DD.MM')} - ${dayjs(secondWeekEnd).format('DD.MM')})`,
          value: `${secondWeekEstimate} ч.`,
        },
      ],
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
    }
  }
}
