import { Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import dayjs from 'dayjs'
import fs from 'fs'
import path from 'path'
import {
  DailyReportCodes,
  EntityTypeIds,
  TASK_SELECT_FIELDS,
  TaskCodes,
} from 'src/constants/const'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { HtmlBuilderService } from 'src/shared/pdf/builder.service'
import { PdfService } from 'src/shared/pdf/pdf.service'
import {
  GroupedTasksWithTimeSpent,
  ReportProps,
  TaskWithTimeSpent,
} from 'src/types/reports'
import { TaskProps } from 'src/types/tasks'

type PreparedReport = {
  buffer: Buffer
  filename: string
  createdAt: number
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

  // private parseNumber(value: unknown): number {
  //   if (typeof value === 'number') return value

  //   if (typeof value === 'string') {
  //     const normalized = value.replace(',', '.').trim()
  //     const parsed = Number(normalized)

  //     return Number.isFinite(parsed) ? parsed : 0
  //   }

  //   return 0
  // }

  // private normalizeSprintDates(value: unknown): string[] {
  //   if (Array.isArray(value)) {
  //     return value
  //       .filter(
  //         (item): item is string =>
  //           typeof item === 'string' && item.trim() !== '',
  //       )
  //       .map((item) => dayjs(item).format('YYYY-MM-DD'))
  //   }

  //   if (typeof value === 'string' && value.trim() !== '') {
  //     return [dayjs(value).format('YYYY-MM-DD')]
  //   }

  //   return []
  // }

  // private isDateInRange(date: string, start: string, end: string) {
  //   const current = dayjs(date)
  //   const rangeStart = dayjs(start)
  //   const rangeEnd = dayjs(end)

  //   return (
  //     current.isSame(rangeStart, 'day') ||
  //     current.isSame(rangeEnd, 'day') ||
  //     (current.isAfter(rangeStart, 'day') && current.isBefore(rangeEnd, 'day'))
  //   )
  // }

  // private taskBelongsToPeriod(
  //   task: TaskWithTimeSpent,
  //   start: string,
  //   end: string,
  // ) {
  //   const sprintDates = this.normalizeSprintDates(
  //     task[TaskCodes.sprintDateStart],
  //   )

  //   return sprintDates.some((date) => this.isDateInRange(date, start, end))
  // }

  // private calculateSpentForPeriod(
  //   tasks: TaskWithTimeSpent[],
  //   start: string,
  //   end: string,
  // ) {
  //   return tasks
  //     .filter((task) => this.taskBelongsToPeriod(task, start, end))
  //     .reduce(
  //       (sum, task) => sum + this.parseNumber(task[TaskCodes.estimateTime]),
  //       0,
  //     )
  // }

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
    console.log({ tasks })
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

    // const totalSpent = tasksWithTimeSpent.reduce(
    //   (sum, task) => sum + task.timeSpent,
    //   0,
    // )
    // const totalSpent = tasksWithTimeSpent.reduce(
    //   (sum, task) => sum + task.timeSpent,
    //   0,
    // )

    // const firstWeekStart = periodStart
    // const firstWeekEnd = dayjs(periodStart).add(6, 'day').format('YYYY-MM-DD')

    // const secondWeekStart = start
    // const secondWeekEnd = end

    // const firstWeekSpent = this.calculateSpentForPeriod(
    //   tasksWithTimeSpent,
    //   firstWeekStart,
    //   firstWeekEnd,
    // )

    // const secondWeekSpent = this.calculateSpentForPeriod(
    //   tasksWithTimeSpent,
    //   secondWeekStart,
    //   secondWeekEnd,
    // )

    const logoBase64 = this.getImageBase64('public/docsLogo/logo.jpg')

    const html = this.htmlService.buildReportHtml({
      groupedTasks,
      periodText: `${dayjs(periodStart).format('DD.MM.YYYY')} - ${dayjs(periodEnd).format('DD.MM.YYYY')}`,
      // summaryRows: [

      //   { label: 'Подразделение', value: 'Отдел разработки' },
      //   {
      //     label: 'Отчетный период',
      //     value: `${dayjs(periodStart).format('DD.MM.YYYY')} - ${dayjs(periodEnd).format('DD.MM.YYYY')}`,
      //   },
      //   {
      //     label: 'Всего задач в перечне',
      //     value: `${tasksWithTimeSpent.length}`,
      //   },
      //   {
      //     label: 'Общая сумма трудозатрат',
      //     value: `${totalSpent} ч.`,
      //   },
      //   {
      //     label: `Сумма трудозатрат за неделю 1 (${dayjs(firstWeekStart).format('DD.MM')}-${dayjs(firstWeekEnd).format('DD.MM.YYYY')})`,
      //     value: `${firstWeekSpent} ч.`,
      //   },
      //   {
      //     label: `Сумма трудозатрат за неделю 2 (${dayjs(secondWeekStart).format('DD.MM')}-${dayjs(secondWeekEnd).format('DD.MM.YYYY')})`,
      //     value: `${secondWeekSpent} ч.`,
      //   },
      // ],
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
}
