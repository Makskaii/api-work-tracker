import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { EntityTypeIds, TaskCodes } from '../constants/const'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import type { SupportHoursReport } from './entities/support-hours-report.entity'
import type { SupportHoursPackageReportSnapshot } from './support-hours-package-report.types'
import { SupportHoursPackagesService } from './support-hours-packages.service'

dayjs.extend(utc)
dayjs.extend(timezone)

export type SupportPackageIssue = {
  code: 'missing_task_hours' | 'task_over_limit' | 'missing_description' | 'project_mismatch' | 'task_unavailable'
  severity: 'warning' | 'error'
  message: string
  entityTypeId: number
  itemId: string
}

@Injectable()
export class SupportPackageChecksService {
  constructor(private readonly packages: SupportHoursPackagesService, private readonly bitrix: BitrixService) {}

  async check(packageId: number) {
    return this.inspect(await this.packages.getReportSnapshot(packageId))
  }

  async inspect(snapshot: SupportHoursPackageReportSnapshot) {
    const issues: SupportPackageIssue[] = []
    const reports = new Map<string, SupportHoursReport>()
    const today = dayjs().tz('Europe/Moscow').format('YYYY-MM-DD')
    for (const consumption of snapshot.consumptions) {
      const date = dayjs(consumption.report.reportDate)
      if (Number(consumption.hours) > 0 && date.isValid() && date.tz('Europe/Moscow').format('YYYY-MM-DD') <= today) reports.set(consumption.report.bitrixReportId, consumption.report)
    }
    for (const task of snapshot.taskContexts) {
      for (const report of task.reports) reports.set(report.bitrixReportId, report)
      const taskIssue = (code: SupportPackageIssue['code'], message: string) => issues.push({ code, severity: 'warning', message, entityTypeId: EntityTypeIds.tasks, itemId: task.id })
      if (task.soldHours === null) taskIssue('missing_task_hours', `Задача «${task.title}»: не указан общий лимит часов`)
      const total = [...new Map(task.reports.map((report) => [report.bitrixReportId, report])).values()].reduce((sum, report) => sum + Number(report.hours), 0)
      if (task.status === 'in_work' && task.soldHours !== null && total > task.soldHours + 0.001) {
        taskIssue('task_over_limit', `Задача «${task.title}»: учтено ${Math.round(total * 100) / 100} ч при лимите ${task.soldHours} ч, задача ещё в работе`)
      }
    }
    for (const report of reports.values()) {
      if (!report.reportDescription?.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) {
        issues.push({ code: 'missing_description', severity: 'warning', message: `Отчёт №${report.bitrixReportId}: не описана выполненная работа`, entityTypeId: EntityTypeIds.reports, itemId: report.bitrixReportId })
      }
    }
    const ids = [...new Set([...reports.values()].map((report) => report.bitrixTaskId).filter((id): id is string => !!id))]
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50)
      const tasks = await this.bitrix.listAllItems<{ id: number | string; [TaskCodes.parentproject]?: number | string | null }>({
        entityTypeId: EntityTypeIds.tasks, filter: { '@id': batch }, select: ['id', TaskCodes.parentproject],
      })
      const byId = new Map<string, typeof tasks[number]>()
      for (const task of tasks) {
        if (!batch.includes(String(task.id)) || byId.has(String(task.id)) || !Object.hasOwn(task, TaskCodes.parentproject)) throw new BadGatewayException('Не удалось проверить принадлежность задач проекту')
        byId.set(String(task.id), task)
      }
      for (const report of reports.values()) {
        if (!report.bitrixTaskId || !batch.includes(report.bitrixTaskId)) continue
        const task = byId.get(report.bitrixTaskId)
        if (!task) {
          if (!issues.some((issue) => issue.code === 'task_unavailable' && issue.itemId === report.bitrixReportId)) {
            issues.push({ code: 'task_unavailable', severity: 'warning', message: `Задача №${report.bitrixTaskId} недоступна в Битриксе. Проверьте привязку отчёта`, entityTypeId: EntityTypeIds.reports, itemId: report.bitrixReportId })
          }
        } else if (String(task[TaskCodes.parentproject]) !== String(snapshot.project.bitrixProjectId)) {
          issues.push({ code: 'project_mismatch', severity: 'error', message: `Отчёт №${report.bitrixReportId} связан с задачей другого проекта. Исправьте привязку перед выгрузкой`, entityTypeId: EntityTypeIds.reports, itemId: report.bitrixReportId })
        }
      }
    }
    return { checkedAt: new Date().toISOString(), issues, blocking: issues.some((issue) => issue.severity === 'error') }
  }
}
