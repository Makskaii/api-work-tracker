import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, EntityManager, In, Repository } from 'typeorm'
import { DailyReportCodes, EntityTypeIds, TaskCodes } from '../constants/const'
import { ReportProject, ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { CreateSupportHoursPackageDto } from './dto/create-support-hours-package.dto'
import { UpdateSupportHoursPackageDto } from './dto/update-support-hours-package.dto'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { allocateSupportHours } from './support-hours-allocation'

const SUPPORT_FLAG = 'ufCrm11_1776177558677'
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
    @InjectRepository(SupportHoursConsumption) private readonly consumptionsRepository: Repository<SupportHoursConsumption>,
    private readonly dataSource: DataSource,
    private readonly bitrixService: BitrixService,
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

  async getReportSnapshot(packageId: number): Promise<SupportHoursPackage> {
    if (this.positiveId(packageId) === null) throw new BadRequestException('A positive package ID is required')
    if (!(await this.packagesRepository.findOne({ where: { id: packageId } }))) {
      throw new NotFoundException('Support hours package not found')
    }
    await this.sync()
    return await this.enqueueMutation(() => this.dataSource.transaction(async (manager) => {
      const item = await manager.getRepository(SupportHoursPackage).findOne({
        where: { id: packageId },
        relations: { project: true, consumptions: { report: true } },
      })
      if (!item) throw new NotFoundException('Support hours package not found')
      return item
    }))
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
      const item = await this.packagesRepository.save(this.packagesRepository.create({
        projectId: project.id,
        purchasedHours: this.round(dto.purchasedHours),
        purchaseDate: dto.purchaseDate,
        amount: dto.amount == null ? null : this.round(dto.amount),
        comment: dto.comment?.trim() || null,
      }))
      await this.reallocateProject(project.id)
      return item
    })
  }

  async update(id: number, dto: UpdateSupportHoursPackageDto) {
    return await this.enqueueMutation(async () => {
      const item = await this.packagesRepository.findOne({ where: { id } })
      if (!item) throw new NotFoundException('Support hours package not found')
      if (dto.purchasedHours !== undefined) item.purchasedHours = this.round(dto.purchasedHours)
      if (dto.purchaseDate !== undefined) item.purchaseDate = dto.purchaseDate
      if (dto.amount !== undefined) item.amount = dto.amount == null ? null : this.round(dto.amount)
      if (dto.comment !== undefined) item.comment = dto.comment?.trim() || null
      const saved = await this.packagesRepository.save(item)
      await this.reallocateProject(item.projectId)
      return saved
    })
  }

  async remove(id: number): Promise<void> {
    return await this.enqueueMutation(async () => {
      const item = await this.packagesRepository.findOne({ where: { id } })
      if (!item) throw new NotFoundException('Support hours package not found')
      await this.packagesRepository.remove(item)
      await this.reallocateProject(item.projectId)
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
      filter: { '>=lastActivityTime': since.toISOString(), [SUPPORT_FLAG]: 'Y' },
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

  private async reallocateProject(projectId: number): Promise<void> {
    await this.dataSource.transaction((manager) => this.reallocateProjectInTransaction(manager, projectId))
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
