import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { Repository } from 'typeorm'
import { DailyReportCodes, EntityTypeIds, ProjectCodes, REPORT_ACTIVITY_IBLOCK_ID, TaskCodes } from '../constants/const'
import { ReportProject, ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { PrepareSupportReportDto } from './dto/prepare-support-report.dto'

type BitrixItem = Record<string, unknown> & { id: number | string }
dayjs.extend(utc)
dayjs.extend(timezone)
const positiveId = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

@Injectable()
export class SupportReportEditorService {
  constructor(
    @InjectRepository(ReportProject) private readonly projects: Repository<ReportProject>,
    private readonly bitrix: BitrixService,
  ) {}

  async formOptions() {
    return { activities: await this.bitrix.getListElements(REPORT_ACTIVITY_IBLOCK_ID) }
  }

  private async project(id: number) {
    const project = await this.projects.findOne({ where: { id, projectType: ReportProjectType.Support } })
    if (!project || !positiveId(project.bitrixProjectId)) throw new NotFoundException('Проект техподдержки не найден')
    return project
  }

  private async report(id: number, projectId: string) {
    const report = await this.bitrix.getItem<BitrixItem>({ entityTypeId: EntityTypeIds.reports, id })
    if (!report || positiveId(report.id) !== id) throw new NotFoundException('Отчёт не найден в Битриксе')
    if (String(report[DailyReportCodes.parentproject]) !== projectId) throw new BadRequestException('Отчёт относится к другому проекту')
    return report
  }

  async edit(projectId: number, reportId: number) {
    const project = await this.project(projectId)
    const report = await this.report(reportId, project.bitrixProjectId!)
    const reportDate = dayjs(String(report.begindate ?? report.createdTime)).tz('Europe/Moscow')
    if (!reportDate.isValid()) throw new BadGatewayException('В Битриксе указана некорректная дата отчёта')
    return {
      id: reportId,
      taskId: positiveId(report[DailyReportCodes.parentId]),
      description: String(report[DailyReportCodes.title] ?? ''),
      hours: Number(String(report[DailyReportCodes.timeSpent] ?? '').replace(',', '.')),
      reportDate: reportDate.format('YYYY-MM-DD'),
      includeInPackage: [true, 1, '1', 'Y'].includes(report[DailyReportCodes.includeInPackage] as string),
      activityId: positiveId(report[DailyReportCodes.activityType]),
    }
  }

  // The browser submits these fields through the signed-in user's Bitrix session.
  // This service never writes through the server's privileged webhook.
  async prepare(projectId: number, dto: PrepareSupportReportDto) {
    const project = await this.project(projectId)
    const description = dto.description.trim()
    if (!description) throw new BadRequestException('Опишите выполненную работу')
    if (dto.reportDate > dayjs().tz('Europe/Moscow').format('YYYY-MM-DD')) throw new BadRequestException('Дата отчёта не может быть в будущем')
    if (dto.reportId) await this.report(dto.reportId, project.bitrixProjectId!)
    const liveProject = await this.bitrix.getItem<BitrixItem>({ entityTypeId: EntityTypeIds.projects, id: Number(project.bitrixProjectId) })
    if (!liveProject || String(liveProject.id) !== project.bitrixProjectId) throw new BadGatewayException('Не удалось проверить проект в Битриксе')
    const projectTypes = liveProject[ProjectCodes.financialProjectType]
    if (!(Array.isArray(projectTypes) ? projectTypes.map(String).includes('410') : String(projectTypes) === '410')) {
      throw new BadRequestException('Проект больше не относится к техподдержке. Обновите данные')
    }
    const task = dto.taskId ? await this.bitrix.getItem<BitrixItem>({ entityTypeId: EntityTypeIds.tasks, id: dto.taskId }) : null
    if (dto.taskId && (!task || positiveId(task.id) !== dto.taskId || String(task[TaskCodes.parentproject]) !== project.bitrixProjectId)) {
      throw new BadRequestException('Задача должна принадлежать выбранному проекту')
    }
    const activities = await this.bitrix.getListElements(REPORT_ACTIVITY_IBLOCK_ID)
    if (!activities.some((activity) => activity.id === dto.activityId)) throw new BadRequestException('Выберите доступный вид работы')
    const fields: Record<string, unknown> = {
      [DailyReportCodes.title]: description,
      [DailyReportCodes.timeSpent]: dto.hours,
      [DailyReportCodes.parentproject]: Number(project.bitrixProjectId),
      [DailyReportCodes.parentId]: dto.taskId ?? 0,
      [DailyReportCodes.company]: positiveId(liveProject[ProjectCodes.company]) ?? 0,
      [DailyReportCodes.activityType]: dto.activityId,
      [DailyReportCodes.includeInPackage]: dto.includeInPackage ? 1 : 0,
      begindate: dto.reportDate,
    }
    if (!dto.reportId) {
      fields.opened = 'Y'
      fields[DailyReportCodes.client] = positiveId(task?.[TaskCodes.client]) ?? 0
      fields[DailyReportCodes.project] = positiveId(task?.[TaskCodes.project]) ?? 0
    }
    return { entityTypeId: EntityTypeIds.reports, fields }
  }
}
