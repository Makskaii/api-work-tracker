import { SupportHoursPackageImpactService } from './support-hours-package-impact.service'
import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, In, Repository } from 'typeorm'
import { DailyReportCodes, EntityTypeIds, TaskCodes, TaskStageIds } from '../constants/const'
import { ReportProject, ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { CreateSupportHoursPackageDto } from './dto/create-support-hours-package.dto'
import { UpdateSupportHoursPackageDto } from './dto/update-support-hours-package.dto'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { allocateSupportHours } from './support-hours-allocation'
import type { SupportHoursPackageReportSnapshot, SupportPackageTaskContext } from './support-hours-package-report.types'
import { parseWorkspaceReport, workspaceId, type SupportProjectWorkspace, type SupportWorkspaceTask } from './support-hours-workspace'

dayjs.extend(utc)
dayjs.extend(timezone)

const SUPPORT_FLAG = 'ufCrm11_1776177558677'
// crm.item.list expects 1/0 for boolean filters, while returned field values are Y/N.
const SUPPORT_FLAG_ENABLED_FILTER = 1
const PROJECT_TYPE = 'ufCrm20_1781683772'
const SUPPORT_PROJECT_TYPE = '410'
const WINDOW_MS = 48 * 60 * 60 * 1000
const PROJECTS_SYNC_TTL_MS = 5 * 60 * 1000
const PROJECT_TASKS_TTL_MS = 5 * 60 * 1000
const REPORT_ACTIVITY_IBLOCK_ID = 25
const REPORT_RECHECK_BATCH_SIZE = 50
const REPORT_SELECT = ['id', 'title', 'begindate', 'createdTime', 'lastActivityTime', 'assignedById', DailyReportCodes.title, DailyReportCodes.timeSpent, DailyReportCodes.parentId, DailyReportCodes.parentproject, DailyReportCodes.company, DailyReportCodes.activityType, SUPPORT_FLAG]

type BitrixSupportReport = {
  id: string | number
  title?: string
  begindate?: string
  createdTime?: string
  lastActivityTime?: string
  assignedById?: string | number | null
  [DailyReportCodes.company]?: string | number | null
  [DailyReportCodes.activityType]?: string | number | null
  [DailyReportCodes.title]?: string | null
  [DailyReportCodes.timeSpent]?: string | number | null
  [DailyReportCodes.parentId]?: string | number | null
  [DailyReportCodes.parentproject]?: string | number | null
  [SUPPORT_FLAG]?: string | number | boolean | null
}

type BitrixProject = {
  id: string | number
  title?: string
  [PROJECT_TYPE]?: string | string[] | number | null
}

type BitrixTask = {
  id: string | number
  title?: string
  stageId?: string | null
  [TaskCodes.hours]?: string | number | null
}

type SupportHoursWebhookPayload = Record<string, unknown>

@Injectable()
export class SupportHoursPackagesService {
  private readonly logger = new Logger(SupportHoursPackagesService.name)
  private supportProjectsSyncPromise: Promise<{ created: number; updated: number }> | null = null
  private supportProjectsLastSyncAt = 0
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private reportsSyncPromise: Promise<{ processedReports: number; synchronizedAt: string }> | null = null
  private readonly supportProjectTasksCache = new Map<number, { expiresAt: number; tasks: BitrixTask[] }>()

  constructor(
    @InjectRepository(ReportProject) private readonly projectsRepository: Repository<ReportProject>,
    @InjectRepository(SupportHoursPackage) private readonly packagesRepository: Repository<SupportHoursPackage>,
    @InjectRepository(SupportHoursReport) private readonly reportsRepository: Repository<SupportHoursReport>,
    @InjectRepository(SupportHoursConsumption) _consumptionsRepository: Repository<SupportHoursConsumption>,
    private readonly dataSource: DataSource,
    private readonly bitrixService: BitrixService,
    private readonly impactService?: SupportHoursPackageImpactService,
  ) {}

  async findAll() {
    const packages = await this.packagesRepository.find({
      relations: { project: true, consumptions: { report: true } },
      order: { purchaseDate: 'ASC', id: 'ASC' },
    })
    const byProject = new Map<number, SupportHoursPackage[]>()
    packages.forEach((item) => byProject.set(item.projectId, [...(byProject.get(item.projectId) ?? []), item]))

    return Array.from(byProject.values()).map((projectPackages) => {
      const purchasedHours = projectPackages.reduce((total, item) => total + this.toNumber(item.purchasedHours), 0)
      const consumedHours = projectPackages.reduce((total, item) => total + item.consumptions.reduce((sum, consumption) => sum + this.toNumber(consumption.hours), 0), 0)
      const remainingHours = this.round(purchasedHours - consumedHours)
      const lastConsumption = projectPackages.flatMap((item) => item.consumptions).toSorted((first, second) => second.report.reportDate.getTime() - first.report.reportDate.getTime()).at(0)
      const state = remainingHours < 0 ? 'overdue' : remainingHours === 0 ? 'empty' : remainingHours <= purchasedHours * 0.1 ? 'ending' : 'active'

      return {
        project: projectPackages[0].project,
        purchasedHours: this.round(purchasedHours),
        consumedHours: this.round(consumedHours),
        remainingHours,
        state,
        lastChargeAt: lastConsumption?.report.reportDate ?? null,
        packages: projectPackages.map((item) => ({
          ...item,
          remainingHours: this.round(this.toNumber(item.purchasedHours) - item.consumptions.reduce((sum, consumption) => sum + this.toNumber(consumption.hours), 0)),
        })),
      }
    })
  }

  async getReportSnapshot(packageId: number): Promise<SupportHoursPackageReportSnapshot> {
    if (this.positiveId(packageId) === null) throw new BadRequestException('A positive package ID is required')
    if (!(await this.packagesRepository.findOne({ where: { id: packageId } }))) {
      throw new NotFoundException('Support hours package not found')
    }
    await this.sync()
    return await this.enqueueMutation(async () => {
      const asOfDate = dayjs().tz('Europe/Moscow').format('YYYY-MM-DD')
      let snapshot = await this.readPackageReportSnapshot(packageId, asOfDate)
      const checkedTaskIds = new Set<string>()
      for (let pass = 0; ; pass += 1) {
        const pendingIds = snapshot.taskIds.filter((id) => !checkedTaskIds.has(id))
        if (!pendingIds.length) break
        if (pass >= 20) throw new BadGatewayException('Package task history did not stabilize')
        await this.importPackageTaskHistory(snapshot.item, pendingIds)
        pendingIds.forEach((id) => checkedTaskIds.add(id))
        // Older reports can redistribute allocations and expose another task in this package.
        snapshot = await this.readPackageReportSnapshot(packageId, asOfDate)
      }
      const { item, taskIds, reports } = snapshot
      // The transaction is closed before reading current task status and the client's agreed hours.
      const tasks = await this.readPackageTaskMetadata(taskIds)
      const taskContexts: SupportPackageTaskContext[] = taskIds.map((id) => {
        const task = tasks.get(id)
        const taskReports = reports.filter((report) => report.bitrixTaskId === id && this.isReportOnOrBefore(report, asOfDate))
          .map((report) => ({
            ...report,
            consumptions: report.consumptions.filter((consumption) => String(consumption.package?.projectId) === String(item.projectId)),
          }))
          .filter((report) => report.consumptions.length > 0)
        const cachedTitle = taskReports.find((report) => report.taskTitle?.trim())?.taskTitle?.trim()
        return {
          id,
          title: task?.title?.trim() || cachedTitle || `Задача №${id}`,
          status: task ? this.packageTaskStatus(task.stageId) : 'unknown',
          soldHours: task ? this.readSoldTaskHours(task[TaskCodes.hours]) : null,
          reports: taskReports,
        }
      })
      return { ...item, taskContexts }
    })
  }

  private async readPackageReportSnapshot(packageId: number, asOfDate: string) {
    return await this.dataSource.transaction(async (manager) => {
      const item = await manager.getRepository(SupportHoursPackage).findOne({
        where: { id: packageId },
        relations: { project: true, consumptions: { report: true } },
      })
      if (!item) throw new NotFoundException('Support hours package not found')
      const taskIds = [...new Set(item.consumptions
        .filter((consumption) => this.toNumber(consumption.hours) > 0 && this.isReportOnOrBefore(consumption.report, asOfDate))
        .map((consumption) => consumption.report.bitrixTaskId)
        .filter((id): id is string => this.positiveId(id) !== null))]
      const reports = taskIds.length ? await manager.getRepository(SupportHoursReport).find({
        where: { projectId: item.projectId, bitrixTaskId: In(taskIds) },
        relations: { consumptions: { package: true } },
        order: { reportDate: 'ASC', id: 'ASC' },
      }) : []
      return { item, taskIds, reports }
    })
  }

  private async importPackageTaskHistory(item: SupportHoursPackage, taskIds: string[]): Promise<void> {
    const projectId = this.positiveId(item.project.bitrixProjectId)
    if (projectId === null) throw new BadGatewayException('Package project has no valid Bitrix ID')
    const discovered = new Map<string, BitrixSupportReport>()
    for (let offset = 0; offset < taskIds.length; offset += REPORT_RECHECK_BATCH_SIZE) {
      const batch = taskIds.slice(offset, offset + REPORT_RECHECK_BATCH_SIZE)
      const reports = await this.bitrixService.listAllItems<BitrixSupportReport>({
        entityTypeId: EntityTypeIds.reports,
        filter: { [SUPPORT_FLAG]: SUPPORT_FLAG_ENABLED_FILTER, [DailyReportCodes.parentproject]: projectId, [`@${DailyReportCodes.parentId}`]: batch },
        select: REPORT_SELECT,
      })
      for (const report of reports) {
        const id = String(report?.id)
        if (this.positiveId(report?.id) === null || discovered.has(id) ||
          !batch.includes(String(report[DailyReportCodes.parentId])) ||
          String(report[DailyReportCodes.parentproject]) !== String(projectId) ||
          !this.isChecked(report[SUPPORT_FLAG]) || !Object.hasOwn(report, DailyReportCodes.timeSpent)) {
          throw new BadGatewayException('Bitrix returned invalid package task history')
        }
        discovered.set(id, report)
      }
    }
    // Fetch and validate every page before importing any historical report.
    for (const [id, report] of discovered) await this.applyReport(id, report)
  }

  private isReportOnOrBefore(report: SupportHoursReport, asOfDate: string): boolean {
    const date = dayjs(report.reportDate)
    return date.isValid() && date.tz('Europe/Moscow').format('YYYY-MM-DD') <= asOfDate
  }

  private async readPackageTaskMetadata(taskIds: string[]): Promise<Map<string, BitrixTask>> {
    const tasks = new Map<string, BitrixTask>()
    for (let offset = 0; offset < taskIds.length; offset += REPORT_RECHECK_BATCH_SIZE) {
      const batch = taskIds.slice(offset, offset + REPORT_RECHECK_BATCH_SIZE)
      const current = await this.bitrixService.listAllItems<BitrixTask>({
        entityTypeId: EntityTypeIds.tasks,
        filter: { '@id': batch },
        select: ['id', 'title', 'stageId', TaskCodes.hours],
      })
      for (const task of current) {
        const id = String(task?.id)
        if (!batch.includes(id) || tasks.has(id) || typeof task.title !== 'string' || typeof task.stageId !== 'string' || !task.stageId || !Object.hasOwn(task, TaskCodes.hours)) {
          throw new BadGatewayException('Bitrix returned invalid task details for the package report')
        }
        this.readSoldTaskHours(task[TaskCodes.hours])
        tasks.set(id, task)
      }
    }
    return tasks
  }

  private readSoldTaskHours(value: unknown): number | null {
    if (value === null || (typeof value === 'string' && value.trim() === '')) return null
    if (typeof value !== 'number' && typeof value !== 'string') throw new BadGatewayException('Bitrix returned invalid client task hours')
    const hours = Number(String(value).replace(',', '.'))
    if (!Number.isFinite(hours) || hours < 0) throw new BadGatewayException('Bitrix returned invalid client task hours')
    return this.round(hours)
  }

  private packageTaskStatus(stageId?: string | null): SupportPackageTaskContext['status'] {
    if (stageId === TaskStageIds.done || stageId === 'DT1072_18:SUCCESS') return 'completed'
    if (stageId === 'DT1072_18:UC_JP9WR1' || stageId === 'DT1072_18:FAIL') return 'cancelled'
    return Object.values(TaskStageIds).some((knownStage) => knownStage === stageId) ? 'in_work' : 'unknown'
  }

  async getProjectWorkspace(projectId: number): Promise<SupportProjectWorkspace> {
    return await this.enqueueMutation(async () => {
      const project = await this.findSupportProject(projectId)
      const sourceProjectId = workspaceId(project.bitrixProjectId)
      const liveProject = await this.bitrixService.getItem<BitrixProject>({ entityTypeId: EntityTypeIds.projects, id: Number(sourceProjectId) })
      if (!liveProject || workspaceId(liveProject.id) !== sourceProjectId || !Object.hasOwn(liveProject, PROJECT_TYPE)) throw new BadGatewayException('Не удалось проверить проект в Битриксе')
      if (!this.isSupportProject(liveProject[PROJECT_TYPE])) throw new BadRequestException('Проект больше не относится к техподдержке. Обновите данные')

      // No activity window or accounting flag: the analyst must see old and excluded reports too.
      const [sourceReports, sourceTasks, previousReports] = await Promise.all([
        this.bitrixService.listAllItems<Record<string, unknown>>({ entityTypeId: EntityTypeIds.reports, filter: { [DailyReportCodes.parentproject]: Number(sourceProjectId) }, select: REPORT_SELECT }),
        this.bitrixService.listAllItems<Record<string, unknown>>({ entityTypeId: EntityTypeIds.tasks, filter: { [TaskCodes.parentproject]: Number(sourceProjectId) }, select: ['id', 'title', 'stageId', TaskCodes.parentproject] }),
        this.reportsRepository.find({ where: { projectId } }),
      ])
      const reports = sourceReports.map(parseWorkspaceReport)
      const reportIds = new Set<string>()
      for (const report of reports) {
        if (report.projectId !== sourceProjectId || reportIds.has(report.id)) throw new BadGatewayException('Битрикс вернул некорректный список отчётов проекта')
        reportIds.add(report.id)
      }
      const tasks = new Map<string, SupportWorkspaceTask>()
      const readTask = (task: Record<string, unknown>): SupportWorkspaceTask => {
        if (!task || typeof task !== 'object' || Array.isArray(task)) throw new BadGatewayException('Битрикс вернул некорректную задачу')
        const id = workspaceId(task.id)
        if (typeof task.title !== 'string' || (task.stageId != null && typeof task.stageId !== 'string')) throw new BadGatewayException('Битрикс вернул некорректную задачу')
        return { id, title: task.title.trim() || `Задача №${id}`, stageId: task.stageId as string | null ?? null }
      }
      for (const task of sourceTasks) {
        const parsed = readTask(task)
        if (workspaceId(task[TaskCodes.parentproject]) !== sourceProjectId || tasks.has(parsed.id)) throw new BadGatewayException('Битрикс вернул некорректный список задач проекта')
        tasks.set(parsed.id, parsed)
      }

      // A missing project row may have moved to another project. Recheck by ID before removing it.
      const absentIds = previousReports.filter((report) => !reportIds.has(report.bitrixReportId)).map((report) => report.bitrixReportId)
      const movedReports: { id: string; prepared: SupportHoursReport | null }[] = []
      for (let offset = 0; offset < absentIds.length; offset += REPORT_RECHECK_BATCH_SIZE) {
        const batch = absentIds.slice(offset, offset + REPORT_RECHECK_BATCH_SIZE)
        const current = await this.bitrixService.listAllItems<BitrixSupportReport>({ entityTypeId: EntityTypeIds.reports, filter: { '@id': batch }, select: REPORT_SELECT })
        const seen = new Set<string>()
        for (const report of current) {
          const id = workspaceId(report.id)
          if (!batch.includes(id) || seen.has(id)) throw new BadGatewayException('Битрикс вернул некорректные данные сверки отчётов')
          seen.add(id)
          const parsed = parseWorkspaceReport(report as Record<string, unknown>)
          // The source changed during pagination; do not treat that as a deletion.
          if (parsed.projectId === sourceProjectId) throw new BadGatewayException('Данные проекта изменились во время загрузки. Обновите данные ещё раз')
          movedReports.push({ id, prepared: parsed.projectId && parsed.includeInPackage && parsed.hours > 0 ? await this.prepareEligibleReport(report) : null })
        }
      }

      const taskMetadata = new Map(tasks)
      const foreignTaskIds = [...new Set(reports.map((report) => report.taskId).filter((id): id is string => !!id && !tasks.has(id)))]
      for (let offset = 0; offset < foreignTaskIds.length; offset += REPORT_RECHECK_BATCH_SIZE) {
        const batch = foreignTaskIds.slice(offset, offset + REPORT_RECHECK_BATCH_SIZE)
        const current = await this.bitrixService.listAllItems<Record<string, unknown>>({ entityTypeId: EntityTypeIds.tasks, filter: { '@id': batch }, select: ['id', 'title', 'stageId'] })
        for (const task of current) {
          const parsed = readTask(task)
          if (!batch.includes(parsed.id) || taskMetadata.has(parsed.id)) throw new BadGatewayException('Битрикс вернул некорректную привязку задачи')
          taskMetadata.set(parsed.id, parsed)
        }
      }
      const userNames = new Map<string, string>()
      const userIds = [...new Set(reports.map((report) => report.responsibleId).filter((id): id is string => !!id))]
      for (let offset = 0; offset < userIds.length; offset += REPORT_RECHECK_BATCH_SIZE) {
        const batch = userIds.slice(offset, offset + REPORT_RECHECK_BATCH_SIZE)
        for (const user of await this.bitrixService.getUsersByIds(batch.map(Number))) userNames.set(String(user.id), user.title)
      }
      const companyNames = new Map<string, string | null>()
      const activityNames = new Map<string, string | null>()
      for (const id of new Set(reports.map((report) => report.companyId).filter((id): id is string => !!id))) {
        companyNames.set(id, (await this.bitrixService.getCompany<{ TITLE?: string }>(Number(id)))?.TITLE?.trim() || null)
      }
      for (const id of new Set(reports.map((report) => report.activityId).filter((id): id is string => !!id))) {
        activityNames.set(id, await this.bitrixService.getListElementTitle(REPORT_ACTIVITY_IBLOCK_ID, Number(id)))
      }
      const preparedReports = reports.filter((report) => report.includeInPackage && report.hours > 0).map((report) => this.reportsRepository.create({
        bitrixReportId: report.id, projectId, hours: report.hours, reportDate: report.reportDate, lastActivityAt: report.lastActivityAt,
        reportTitle: report.title, reportDescription: report.description, bitrixTaskId: report.taskId,
        taskTitle: report.taskId ? taskMetadata.get(report.taskId)?.title ?? null : null,
        bitrixResponsibleId: report.responsibleId, responsibleName: report.responsibleId ? userNames.get(report.responsibleId) ?? null : null,
        bitrixCompanyId: report.companyId, companyName: report.companyId ? companyNames.get(report.companyId) ?? null : null,
        projectTitle: liveProject.title?.trim() || project.title, bitrixActivityId: report.activityId,
        activityTitle: report.activityId ? activityNames.get(report.activityId) ?? null : null,
      }))

      const result = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(SupportHoursReport)
        const incoming = [...preparedReports, ...movedReports.flatMap((report) => report.prepared ? [report.prepared] : [])]
        const known = incoming.length ? await repository.find({ where: { bitrixReportId: In(incoming.map((report) => report.bitrixReportId)) } }) : []
        const affectedProjects = new Set<number>([projectId])
        const retainedIds = new Set(incoming.map((report) => report.bitrixReportId))
        for (const existing of previousReports) {
          if (!retainedIds.has(existing.bitrixReportId)) await repository.remove(existing)
        }
        for (const prepared of incoming) {
          const existing = known.find((report) => report.bitrixReportId === prepared.bitrixReportId)
          if (existing) affectedProjects.add(Number(existing.projectId))
          affectedProjects.add(Number(prepared.projectId))
          await repository.save(repository.merge(existing ?? repository.create({ bitrixReportId: prepared.bitrixReportId }), prepared))
        }
        for (const affectedProject of affectedProjects) await this.reallocateProjectInTransaction(manager, affectedProject)
        const packages = await manager.getRepository(SupportHoursPackage).find({
          where: { projectId }, relations: { consumptions: { report: true } }, order: { purchaseDate: 'ASC', id: 'ASC' },
        })
        const allocations = new Map<string, { purchaseId: number; purchaseDate: string; hours: number }[]>()
        for (const item of packages) for (const row of item.consumptions) {
          const id = row.report.bitrixReportId
          allocations.set(id, [...allocations.get(id) ?? [], { purchaseId: Number(item.id), purchaseDate: item.purchaseDate, hours: this.toNumber(row.hours) }])
        }
        const purchasedHours = this.round(packages.reduce((sum, item) => sum + this.toNumber(item.purchasedHours), 0))
        const consumedHours = this.round(packages.reduce((sum, item) => sum + item.consumptions.reduce((hours, row) => hours + this.toNumber(row.hours), 0), 0))
        const remainingHours = this.round(purchasedHours - consumedHours)
        const lastChargeAt = packages.flatMap((item) => item.consumptions).toSorted((first, second) => second.report.reportDate.getTime() - first.report.reportDate.getTime()).at(0)?.report.reportDate ?? null
        return {
          projectId, tasks: [...tasks.values()].sort((first, second) => first.title.localeCompare(second.title, 'ru')),
          reports: reports.sort((first, second) => second.reportDate.getTime() - first.reportDate.getTime() || Number(second.id) - Number(first.id)).map((report) => {
            const rows = report.includeInPackage ? allocations.get(report.id) ?? [] : []
            const allocatedHours = this.round(rows.reduce((sum, row) => sum + row.hours, 0))
            return {
              id: report.id, taskId: report.taskId, taskTitle: report.taskId ? taskMetadata.get(report.taskId)?.title ?? null : null,
              responsibleName: report.responsibleId ? userNames.get(report.responsibleId) ?? null : null,
              date: dayjs(report.reportDate).tz('Europe/Moscow').format('YYYY-MM-DD'), hours: report.hours,
              title: report.title, description: report.description, includeInPackage: report.includeInPackage, allocations: rows,
              allocatedHours, unallocatedHours: report.includeInPackage ? this.round(Math.max(0, report.hours - allocatedHours)) : 0,
            }
          }),
          packageGroup: {
            project: { ...project, title: liveProject.title?.trim() || project.title }, purchasedHours, consumedHours, remainingHours,
            state: remainingHours < 0 ? 'overdue' : remainingHours === 0 ? 'empty' : remainingHours <= purchasedHours * 0.1 ? 'ending' : 'active', lastChargeAt,
            packages: packages.map((item) => ({ ...item, project, remainingHours: this.round(this.toNumber(item.purchasedHours) - item.consumptions.reduce((sum, row) => sum + this.toNumber(row.hours), 0)) })),
          },
        }
      })
      this.supportProjectTasksCache.delete(projectId)
      return result
    })
  }

  async findSupportProjects() {
    return await this.projectsRepository.find({
      where: { projectType: ReportProjectType.Support },
      order: { title: 'ASC', id: 'ASC' },
    })
  }

  async findSupportProjectTasks(projectId: number) {
    const cached = this.supportProjectTasksCache.get(projectId)
    if (cached && cached.expiresAt > Date.now()) return cached.tasks

    const project = await this.findSupportProject(projectId)
    const bitrixProjectId = Number(project.bitrixProjectId)
    if (!Number.isSafeInteger(bitrixProjectId) || bitrixProjectId <= 0) {
      throw new BadRequestException('Support project Bitrix ID is invalid')
    }

    const tasks = (await this.bitrixService.listAllItems<BitrixTask>({
      entityTypeId: EntityTypeIds.tasks,
      filter: { [TaskCodes.parentproject]: bitrixProjectId },
      select: ['id', 'title', 'stageId'],
    }))
      .map((task) => ({
        id: task.id,
        title: task.title?.trim() || `Задача ${task.id}`,
        stageId: task.stageId ?? null,
      }))
      .toSorted((first, second) => first.title.localeCompare(second.title, 'ru'))

    this.supportProjectTasksCache.set(projectId, {
      tasks,
      expiresAt: Date.now() + PROJECT_TASKS_TTL_MS,
    })
    return tasks
  }

  async syncSupportProjects() {
    if (Date.now() - this.supportProjectsLastSyncAt < PROJECTS_SYNC_TTL_MS) {
      return { created: 0, updated: 0 }
    }
    if (!this.supportProjectsSyncPromise) {
      this.supportProjectsSyncPromise = this.performSupportProjectsSync()
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          this.logger.error(`Support projects synchronization failed: ${reason}`)
          throw error
        })
        .finally(() => {
          this.supportProjectsSyncPromise = null
        })
    }
    return await this.supportProjectsSyncPromise
  }

  async processReportWebhook(payload: SupportHoursWebhookPayload) {
    const token = payload.secret ?? payload.token ?? this.readWebhookValue(payload, ['auth', 'application_token'])
    if (!this.isWebhookTokenValid(token)) throw new UnauthorizedException('Invalid support hours webhook token')

    const event = String(payload.event ?? '').toUpperCase()
    if (event && event !== 'ONCRMDYNAMICITEMADD' && event !== 'ONCRMDYNAMICITEMUPDATE' && event !== 'ONCRMDYNAMICITEMDELETE') {
      return { processed: false, reason: 'unsupported_event' }
    }

    const entityTypeId = this.readWebhookValue(payload, ['data', 'FIELDS', 'ENTITY_TYPE_ID']) ?? payload.entityTypeId
    if ((entityTypeId == null && event === 'ONCRMDYNAMICITEMDELETE') || (entityTypeId != null && this.positiveId(entityTypeId) !== EntityTypeIds.reports)) {
      return { processed: false, reason: 'unsupported_entity_type' }
    }

    const reportId = this.readWebhookValue(payload, ['data', 'FIELDS', 'ID']) ?? payload.reportId ?? payload.id
    const parsedReportId = this.positiveId(reportId)
    if (parsedReportId === null) throw new BadRequestException('A positive integer Bitrix report ID is required')

    return await this.enqueueMutation(async () => {
      if (event === 'ONCRMDYNAMICITEMDELETE') {
        await this.applyReport(String(parsedReportId), null)
        return { processed: true, reportId: String(parsedReportId) }
      }
      const report = await this.bitrixService.getItem<BitrixSupportReport>({
        entityTypeId: EntityTypeIds.reports,
        id: parsedReportId,
      })
      if (!report || String(report.id) !== String(parsedReportId)) throw new BadGatewayException('Bitrix returned an invalid report')
      const eligible = await this.applyReport(String(parsedReportId), report)
      return { processed: eligible, reportId: String(parsedReportId) }
    })
  }

  async create(dto: CreateSupportHoursPackageDto) {
    return await this.enqueueMutation(async () => {
      const project = await this.findSupportProject(dto.projectId)
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(SupportHoursPackage)
        const item = await repository.save(repository.create({
          projectId: project.id,
          purchasedHours: this.round(dto.purchasedHours),
          purchaseDate: dto.purchaseDate,
          amount: dto.amount == null ? null : this.round(dto.amount),
          comment: dto.comment?.trim() || null,
        }))
        await this.reallocateProjectInTransaction(manager, project.id)
        return item
      })
    })
  }

  async update(id: number, dto: UpdateSupportHoursPackageDto, fingerprint?: string) {
    return await this.enqueueMutation(async () => {
      await this.impactService?.assertPreview(id, { operation: 'update', changes: dto }, fingerprint)
      return await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(SupportHoursPackage)
        const item = await repository.findOne({ where: { id } })
        if (!item) throw new NotFoundException('Support hours package not found')
        if (dto.purchasedHours !== undefined) item.purchasedHours = this.round(dto.purchasedHours)
        if (dto.purchaseDate !== undefined) item.purchaseDate = dto.purchaseDate
        if (dto.amount !== undefined) item.amount = dto.amount == null ? null : this.round(dto.amount)
        if (dto.comment !== undefined) item.comment = dto.comment?.trim() || null
        const saved = await repository.save(item)
        await this.reallocateProjectInTransaction(manager, item.projectId)
        return saved
      })
    })
  }

  async remove(id: number, fingerprint?: string): Promise<void> {
    return await this.enqueueMutation(async () => {
      await this.impactService?.assertPreview(id, { operation: 'delete' }, fingerprint)
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(SupportHoursPackage)
        const item = await repository.findOne({ where: { id } })
        if (!item) throw new NotFoundException('Support hours package not found')
        await repository.remove(item)
        await this.reallocateProjectInTransaction(manager, item.projectId)
      })
    })
  }

  async sync() {
    if (!this.reportsSyncPromise) {
      this.reportsSyncPromise = this.enqueueMutation(() => this.performReportsSync())
        .finally(() => { this.reportsSyncPromise = null })
    }
    return await this.reportsSyncPromise
  }

  private async performReportsSync() {
    const since = new Date(Date.now() - WINDOW_MS)
    const cached = await this.reportsRepository.find()
    const reports = await this.bitrixService.listAllItems<BitrixSupportReport>({
      entityTypeId: EntityTypeIds.reports,
      filter: { '>=lastActivityTime': since.toISOString(), [SUPPORT_FLAG]: SUPPORT_FLAG_ENABLED_FILTER },
      select: REPORT_SELECT,
    })
    const cachedIds = new Set(cached.map((report) => report.bitrixReportId))
    for (const report of reports) {
      if (this.positiveId(report.id) === null) throw new BadGatewayException('Bitrix returned an invalid report ID')
      // Known reports are read again without eligibility filters below.
      if (!cachedIds.has(String(report.id))) await this.applyReport(String(report.id), report)
    }

    for (let offset = 0; offset < cached.length; offset += REPORT_RECHECK_BATCH_SIZE) {
      const batch = cached.slice(offset, offset + REPORT_RECHECK_BATCH_SIZE)
      const ids = batch.map((report) => report.bitrixReportId)
      if (ids.some((id) => this.positiveId(id) === null)) throw new BadGatewayException('Cached report ID is invalid')
      const current = await this.bitrixService.listAllItems<BitrixSupportReport>({
        entityTypeId: EntityTypeIds.reports,
        filter: { '@id': ids },
        select: REPORT_SELECT,
      })
      const byId = new Map<string, BitrixSupportReport>()
      for (const report of current) {
        const id = String(report?.id)
        if (!ids.includes(id) || byId.has(id) ||
          !Object.hasOwn(report, SUPPORT_FLAG) ||
          !Object.hasOwn(report, DailyReportCodes.timeSpent) ||
          !Object.hasOwn(report, DailyReportCodes.parentproject)) {
          throw new BadGatewayException('Bitrix returned an invalid report recheck response')
        }
        byId.set(id, report)
      }
      // Only a complete successful, unfiltered response can establish absence.
      for (const report of batch) {
        await this.applyReport(report.bitrixReportId, byId.get(report.bitrixReportId) ?? null)
      }
    }
    this.supportProjectTasksCache.clear()
    return { processedReports: reports.length, synchronizedAt: new Date().toISOString() }
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.catch(() => undefined)
    return result
  }

  private async applyReport(bitrixReportId: string, report: BitrixSupportReport | null): Promise<boolean> {
    if (report && (!Object.hasOwn(report, SUPPORT_FLAG) || !Object.hasOwn(report, DailyReportCodes.timeSpent) || !Object.hasOwn(report, DailyReportCodes.parentproject))) {
      throw new BadGatewayException('Bitrix returned an invalid report')
    }
    const prepared = report ? await this.prepareEligibleReport(report) : null
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SupportHoursReport)
      const existing = await repository.findOne({ where: { bitrixReportId } })
      const projectIds = new Set<number>()
      if (existing) projectIds.add(existing.projectId)
      if (prepared) {
        // Fresh TypeORM entities have own undefined fields; merge preserves the existing primary key and timestamps.
        const entity = repository.merge(existing ?? repository.create({ bitrixReportId }), prepared)
        await repository.save(entity)
        projectIds.add(prepared.projectId)
      } else if (existing) {
        await repository.remove(existing)
      }
      for (const projectId of projectIds) await this.reallocateProjectInTransaction(manager, projectId)
    })
    return prepared !== null
  }

  private async prepareEligibleReport(report: BitrixSupportReport): Promise<SupportHoursReport | null> {
    const bitrixProjectId = String(report[DailyReportCodes.parentproject] ?? '')
    const hours = this.toNumber(report[DailyReportCodes.timeSpent])
    if (!this.isChecked(report[SUPPORT_FLAG]) || !bitrixProjectId || hours <= 0) return null
    const bitrixProject = await this.bitrixService.getItem<BitrixProject>({ entityTypeId: EntityTypeIds.projects, id: Number(bitrixProjectId) })
    if (!bitrixProject || String(bitrixProject.id) !== bitrixProjectId || !Object.hasOwn(bitrixProject, PROJECT_TYPE)) {
      throw new BadGatewayException('Bitrix returned an invalid project')
    }
    if (!this.isSupportProject(bitrixProject[PROJECT_TYPE])) return null
    const project = await this.upsertSupportProject(bitrixProject)
    if (!project) return null
    const reportDate = this.toDate(report.begindate ?? report.createdTime)
    const lastActivityAt = this.toDate(report.lastActivityTime ?? report.createdTime)
    if (!reportDate || !lastActivityAt) throw new BadGatewayException('Bitrix returned invalid report dates')

    const bitrixReportId = String(report.id)
    const entity = this.reportsRepository.create({ bitrixReportId, projectId: project.id })
    entity.projectId = project.id
    entity.hours = this.round(hours)
    entity.reportDate = reportDate
    entity.lastActivityAt = lastActivityAt
    entity.reportTitle = report.title?.trim() || null
    entity.reportDescription = report[DailyReportCodes.title]?.trim() || null
    const bitrixTaskId = String(report[DailyReportCodes.parentId] ?? '').trim()
    const validTaskId = this.positiveId(bitrixTaskId)
    const task = validTaskId !== null
      ? (await this.bitrixService.listAllItems<BitrixTask>({ entityTypeId: EntityTypeIds.tasks, filter: { '@id': [validTaskId] }, select: ['id', 'title'] })).at(0)
      : null
    entity.bitrixTaskId = validTaskId === null ? null : bitrixTaskId
    entity.taskTitle = task?.title?.trim() || null
    const bitrixResponsibleId = String(report.assignedById ?? '').trim()
    const responsibleId = Number(bitrixResponsibleId)
    const responsible = this.positiveId(responsibleId) !== null
      ? (await this.bitrixService.getUsersByIds([responsibleId])).at(0)
      : null
    entity.bitrixResponsibleId = bitrixResponsibleId || null
    entity.responsibleName = responsible?.title?.trim() || null
    const bitrixCompanyId = String(report[DailyReportCodes.company] ?? '').trim()
    const bitrixActivityId = String(report[DailyReportCodes.activityType] ?? '').trim()
    const [company, activityTitle] = await Promise.all([
      this.positiveId(bitrixCompanyId) !== null
        ? this.bitrixService.getCompany<{ TITLE?: string }>(Number(bitrixCompanyId))
        : Promise.resolve(null),
      this.positiveId(bitrixActivityId) !== null
        ? this.bitrixService.getListElementTitle(REPORT_ACTIVITY_IBLOCK_ID, Number(bitrixActivityId))
        : Promise.resolve(null),
    ])
    entity.bitrixCompanyId = bitrixCompanyId || null
    entity.companyName = company?.TITLE?.trim() || null
    entity.projectTitle = project.title?.trim() || null
    entity.bitrixActivityId = bitrixActivityId || null
    entity.activityTitle = activityTitle
    return entity
  }

  private async performSupportProjectsSync() {
    const bitrixProjects = await this.bitrixService.listAllItems<BitrixProject>({
      entityTypeId: EntityTypeIds.projects,
      filter: { [PROJECT_TYPE]: SUPPORT_PROJECT_TYPE },
      select: ['id', 'title', PROJECT_TYPE],
    })
    let created = 0
    let updated = 0

    for (const bitrixProject of bitrixProjects) {
      const project = await this.projectsRepository.findOne({ where: { bitrixProjectId: String(bitrixProject.id) } })
      const title = bitrixProject.title?.trim() || project?.title || `Проект ${bitrixProject.id}`
      if (!project) {
        await this.projectsRepository.save(this.projectsRepository.create({
          bitrixProjectId: String(bitrixProject.id),
          title,
          projectType: ReportProjectType.Support,
        }))
        created += 1
        continue
      }
      if (project.title !== title || project.projectType !== ReportProjectType.Support) {
        project.title = title
        project.projectType = ReportProjectType.Support
        await this.projectsRepository.save(project)
        updated += 1
      }
    }

    this.supportProjectsLastSyncAt = Date.now()
    return { created, updated }
  }

  private readWebhookValue(payload: SupportHoursWebhookPayload, path: string[]) {
    let value: unknown = payload
    for (const key of path) {
      if (!value || typeof value !== 'object') {
        value = undefined
        break
      }
      value = (value as Record<string, unknown>)[key]
    }
    if (value != null) return value
    const flatKey = `${path[0]}${path.slice(1).map((key) => `[${key}]`).join('')}`
    return payload[flatKey]
  }

  private isWebhookTokenValid(value: unknown) {
    const expected = process.env.SUPPORT_HOURS_WEBHOOK_SECRET
    const received = String(value ?? '')
    if (!expected || !received) return false
    const expectedBuffer = Buffer.from(expected)
    const receivedBuffer = Buffer.from(received)
    return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
  }

  private async upsertSupportProject(bitrixProject: BitrixProject) {
    const bitrixProjectId = String(bitrixProject.id)
    const existing = await this.projectsRepository.findOne({ where: { bitrixProjectId } })
    const title = bitrixProject.title?.trim() || existing?.title || `Проект ${bitrixProjectId}`
    if (existing) {
      if (existing.title !== title || existing.projectType !== ReportProjectType.Support) {
        existing.title = title
        existing.projectType = ReportProjectType.Support
        return this.projectsRepository.save(existing)
      }
      return existing
    }
    return this.projectsRepository.save(this.projectsRepository.create({
      bitrixProjectId,
      title,
      projectType: ReportProjectType.Support,
    }))
  }

  private async reallocateProjectInTransaction(manager: EntityManager, projectId: number): Promise<void> {
    const packagesRepository = manager.getRepository(SupportHoursPackage)
    const reportsRepository = manager.getRepository(SupportHoursReport)
    const consumptionsRepository = manager.getRepository(SupportHoursConsumption)
    const packages = await packagesRepository.find({ where: { projectId }, order: { purchaseDate: 'ASC', id: 'ASC' } })
    if (!packages.length) return
    await consumptionsRepository.delete({ packageId: In(packages.map((item) => item.id)) })
    const reports = await reportsRepository.find({ where: { projectId }, order: { reportDate: 'ASC', id: 'ASC' } })
    const consumed = new Map<number, number>()
    const rows: SupportHoursConsumption[] = []
    for (const report of reports) {
      const allocations = allocateSupportHours(packages.map((item) => ({ id: item.id, purchasedHours: this.toNumber(item.purchasedHours), consumedHours: consumed.get(item.id) ?? 0 })), this.toNumber(report.hours))
      allocations.forEach((allocation) => {
        consumed.set(allocation.packageId, (consumed.get(allocation.packageId) ?? 0) + allocation.hours)
        rows.push(consumptionsRepository.create({ reportId: report.id, packageId: allocation.packageId, hours: this.round(allocation.hours) }))
      })
    }
    if (rows.length) await consumptionsRepository.save(rows)
  }

  private async findSupportProject(id: number) {
    const project = await this.projectsRepository.findOne({ where: { id, projectType: ReportProjectType.Support } })
    if (!project) throw new BadRequestException('Support project not found')
    return project
  }

  private positiveId(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null
    if (typeof value === 'string' && !/^\d+$/.test(value)) return null
    const id = Number(value)
    return Number.isSafeInteger(id) && id > 0 ? id : null
  }

  private isChecked(value: unknown): boolean { return value === true || value === 1 || value === '1' || value === 'Y' }
  private isSupportProject(value: unknown): boolean { return Array.isArray(value) ? value.map(String).includes(SUPPORT_PROJECT_TYPE) : String(value ?? '') === SUPPORT_PROJECT_TYPE }
  private toDate(value: string | undefined): Date | null { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null }
  private toNumber(value: unknown): number { const valueAsNumber = Number(String(value ?? '').replace(',', '.')); return Number.isFinite(valueAsNumber) ? valueAsNumber : 0 }
  private round(value: number): number { return Math.round(value * 100) / 100 }
}
