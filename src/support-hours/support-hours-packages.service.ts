import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { timingSafeEqual } from 'crypto'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm'
import { DailyReportCodes, EntityTypeIds } from '../constants/const'
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

type BitrixSupportReport = {
  id: string | number
  title?: string
  begindate?: string
  createdTime?: string
  lastActivityTime?: string
  assignedById?: string | number | null
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
}

type SupportHoursWebhookPayload = Record<string, unknown>

@Injectable()
export class SupportHoursPackagesService {
  private readonly logger = new Logger(SupportHoursPackagesService.name)
  private supportProjectsSyncPromise: Promise<{ created: number; updated: number }> | null = null
  private supportProjectsLastSyncAt = 0

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

  async findSupportProjects() {
    return this.projectsRepository.find({
      where: { projectType: ReportProjectType.Support },
      order: { title: 'ASC', id: 'ASC' },
    })
  }

  async syncSupportProjects() {
    if (Date.now() - this.supportProjectsLastSyncAt < PROJECTS_SYNC_TTL_MS) {
      return { created: 0, updated: 0 }
    }
    if (!this.supportProjectsSyncPromise) {
      this.supportProjectsSyncPromise = this.performSupportProjectsSync().finally(() => {
        this.supportProjectsSyncPromise = null
      })
    }
    return this.supportProjectsSyncPromise
  }

  async processReportWebhook(payload: SupportHoursWebhookPayload) {
    const token = this.readWebhookValue(payload, ['auth', 'application_token']) ?? payload.secret ?? payload.token
    if (!this.isWebhookTokenValid(token)) throw new UnauthorizedException('Invalid support hours webhook token')

    const event = String(payload.event ?? '').toUpperCase()
    if (event && event !== 'ONCRMDYNAMICITEMADD' && event !== 'ONCRMDYNAMICITEMUPDATE') {
      return { processed: false, reason: 'unsupported_event' }
    }

    const entityTypeId = this.readWebhookValue(payload, ['data', 'FIELDS', 'ENTITY_TYPE_ID']) ?? payload.entityTypeId
    if (entityTypeId != null && Number(entityTypeId) !== EntityTypeIds.reports) {
      return { processed: false, reason: 'unsupported_entity_type' }
    }

    const reportId = this.readWebhookValue(payload, ['data', 'FIELDS', 'ID']) ?? payload.reportId ?? payload.id
    if (!reportId || !Number.isFinite(Number(reportId))) throw new BadRequestException('Bitrix report ID is required')

    const report = await this.bitrixService.getItem<BitrixSupportReport>({
      entityTypeId: EntityTypeIds.reports,
      id: Number(reportId),
    })
    if (!report) throw new BadRequestException('Bitrix report was not found')

    const projectId = await this.saveEligibleReport(report)
    if (projectId) await this.reallocateProject(projectId)
    return { processed: Boolean(projectId), reportId: String(reportId) }
  }

  async create(dto: CreateSupportHoursPackageDto) {
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
  }

  async update(id: number, dto: UpdateSupportHoursPackageDto) {
    const item = await this.packagesRepository.findOne({ where: { id } })
    if (!item) throw new NotFoundException('Support hours package not found')
    if (dto.purchasedHours !== undefined) item.purchasedHours = this.round(dto.purchasedHours)
    if (dto.purchaseDate !== undefined) item.purchaseDate = dto.purchaseDate
    if (dto.amount !== undefined) item.amount = dto.amount == null ? null : this.round(dto.amount)
    if (dto.comment !== undefined) item.comment = dto.comment?.trim() || null
    const saved = await this.packagesRepository.save(item)
    await this.reallocateProject(item.projectId)
    return saved
  }

  async remove(id: number): Promise<void> {
    const item = await this.packagesRepository.findOne({ where: { id } })
    if (!item) throw new NotFoundException('Support hours package not found')
    await this.packagesRepository.remove(item)
    await this.reallocateProject(item.projectId)
  }

  async sync() {
    const since = new Date(Date.now() - WINDOW_MS)
    const reports = await this.bitrixService.listAllItems<BitrixSupportReport>({
      entityTypeId: EntityTypeIds.reports,
      filter: { [`>=lastActivityTime`]: since.toISOString(), [SUPPORT_FLAG]: 'Y' },
      select: ['id', 'title', 'begindate', 'createdTime', 'lastActivityTime', 'assignedById', DailyReportCodes.title, DailyReportCodes.timeSpent, DailyReportCodes.parentId, DailyReportCodes.parentproject, SUPPORT_FLAG],
    })
    const projectIds = new Set<number>()

    for (const report of reports) {
      const projectId = await this.saveEligibleReport(report)
      if (projectId) projectIds.add(projectId)
    }

    const cached = await this.reportsRepository.find({ where: { lastActivityAt: MoreThanOrEqual(since) } })
    for (const cachedReport of cached) {
      try {
        const report = await this.bitrixService.getItem<BitrixSupportReport>({ entityTypeId: EntityTypeIds.reports, id: Number(cachedReport.bitrixReportId) })
        if (!report || !(await this.saveEligibleReport(report))) {
          await this.reportsRepository.remove(cachedReport)
          projectIds.add(cachedReport.projectId)
        }
      } catch (error) {
        this.logger.warn(`Unable to recheck Bitrix report ${cachedReport.bitrixReportId}`)
      }
    }

    await Promise.all(Array.from(projectIds).map((projectId) => this.reallocateProject(projectId)))
    return { processedReports: reports.length, synchronizedAt: new Date().toISOString() }
  }

  private async saveEligibleReport(report: BitrixSupportReport): Promise<number | null> {
    const bitrixProjectId = String(report[DailyReportCodes.parentproject] ?? '')
    const hours = this.toNumber(report[DailyReportCodes.timeSpent])
    if (!this.isChecked(report[SUPPORT_FLAG]) || !bitrixProjectId || hours <= 0) return null
    const bitrixProject = await this.bitrixService.getItem<BitrixProject>({ entityTypeId: EntityTypeIds.projects, id: Number(bitrixProjectId) })
    if (!bitrixProject || !this.isSupportProject(bitrixProject[PROJECT_TYPE])) return null
    const project = await this.upsertSupportProject(bitrixProject)
    if (!project) return null
    const reportDate = this.toDate(report.begindate ?? report.createdTime)
    const lastActivityAt = this.toDate(report.lastActivityTime ?? report.createdTime)
    if (!reportDate || !lastActivityAt) return null

    const bitrixReportId = String(report.id)
    const existing = await this.reportsRepository.findOne({ where: { bitrixReportId } })
    const entity = existing ?? this.reportsRepository.create({ bitrixReportId, projectId: project.id })
    entity.projectId = project.id
    entity.hours = this.round(hours)
    entity.reportDate = reportDate
    entity.lastActivityAt = lastActivityAt
    entity.reportTitle = report.title?.trim() || null
    entity.reportDescription = report[DailyReportCodes.title]?.trim() || null
    const bitrixTaskId = String(report[DailyReportCodes.parentId] ?? '').trim()
    const task = bitrixTaskId
      ? await this.bitrixService.getItem<BitrixTask>({ entityTypeId: EntityTypeIds.tasks, id: Number(bitrixTaskId) })
      : null
    entity.bitrixTaskId = bitrixTaskId || null
    entity.taskTitle = task?.title?.trim() || null
    const bitrixResponsibleId = String(report.assignedById ?? '').trim()
    const responsibleId = Number(bitrixResponsibleId)
    const responsible = Number.isFinite(responsibleId)
      ? (await this.bitrixService.getUsersByIds([responsibleId])).at(0)
      : null
    entity.bitrixResponsibleId = bitrixResponsibleId || null
    entity.responsibleName = responsible?.title?.trim() || null
    await this.reportsRepository.save(entity)
    return project.id
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
    await this.dataSource.transaction(async (manager) => {
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
    })
  }

  private async findSupportProject(id: number) {
    const project = await this.projectsRepository.findOne({ where: { id, projectType: ReportProjectType.Support } })
    if (!project) throw new BadRequestException('Support project not found')
    return project
  }

  private isChecked(value: unknown): boolean { return value === true || value === 1 || value === '1' || value === 'Y' }
  private isSupportProject(value: unknown): boolean { return Array.isArray(value) ? value.map(String).includes(SUPPORT_PROJECT_TYPE) : String(value ?? '') === SUPPORT_PROJECT_TYPE }
  private toDate(value: string | undefined): Date | null { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date : null }
  private toNumber(value: unknown): number { const valueAsNumber = Number(String(value ?? '').replace(',', '.')); return Number.isFinite(valueAsNumber) ? valueAsNumber : 0 }
  private round(value: number): number { return Math.round(value * 100) / 100 }
}
