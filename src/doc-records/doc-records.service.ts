import { Injectable, NotFoundException } from '@nestjs/common'
import {
  EntityTypeIds,
  TASK_SELECT_FIELDS,
  TaskCodes,
} from 'src/constants/const'

import dayjs from 'dayjs'
import { TaskProps } from 'src/types/tasks'
import { HtmlBuilderService } from 'src/shared/pdf/builder.service'
import { PdfService } from 'src/shared/pdf/pdf.service'
import { randomUUID } from 'crypto'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'

type PreparedReport = {
  buffer: Buffer
  filename: string
  createdAt: number
}

@Injectable()
export class DocRecordsService {
  private readonly reports = new Map<string, PreparedReport>()
  private readonly ttlMs = 1000 * 60 * 10 // 10 минут

  constructor(
    private readonly bitrixService: BitrixService,
    private readonly htmlService: HtmlBuilderService,
    private readonly pdfService: PdfService,
  ) {}

  async prepareReport(projId: string, start: string, end: string) {
    this.clearExpiredReports()

    const groupedTasks = await this.bitrixService
      .listItems(EntityTypeIds.tasks, TASK_SELECT_FIELDS, {
        '>=movedTime': dayjs(start).subtract(7, 'day').format('YYYY-MM-DD'),
        '<=movedTime': end,
        stageId: 'DT1072_18:UC_6JNSDG',
        [TaskCodes.project]: projId,
      })
      .then((res) => {
        if (!res) return {}

        return res.reduce<Record<string, TaskProps[]>>((acc, task) => {
          const date = dayjs(task.movedTime).format('YYYY-MM-DD')

          if (!acc[date]) acc[date] = []

          acc[date].push(task)

          return acc
        }, {})
      })

    const html = this.htmlService.buildReportHtml(groupedTasks)
    const pdf = await this.pdfService.generatePdf(html)

    const reportId = randomUUID()
    const filename = `report_${projId}_${start}_${end}.pdf`

    this.reports.set(reportId, {
      buffer: pdf,
      filename,
      createdAt: Date.now(),
    })

    return {
      reportId,
      downloadUrl: `/doc-records/report/${reportId}`,
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
