import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateProjectGanttEventDto } from './dto/create-project-gantt-event.dto'
import { CreateProjectGanttStageDto } from './dto/create-project-gantt-stage.dto'
import { CreateProjectPaymentDto } from './dto/create-project-payment.dto'
import { CreateProjectReportEntryDto } from './dto/create-project-report-entry.dto'
import { CreateReportProjectDto } from './dto/create-project-report-project.dto'
import { UpdateProjectGanttEventDto } from './dto/update-project-gantt-event.dto'
import { UpdateProjectGanttStageDto } from './dto/update-project-gantt-stage.dto'
import { UpdateProjectPaymentDto } from './dto/update-project-payment.dto'
import { UpdateProjectReportEntryDto } from './dto/update-project-report-entry.dto'
import { UpdateReportProjectDto } from './dto/update-project-report-project.dto'
import {
  ProjectGanttEvent,
  ProjectGanttEventKind,
} from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ProjectReportEntryFile } from './entities/project-report-entry-file.entity'
import { ProjectReportEntry } from './entities/project-report-entry.entity'
import { ReportProject } from './entities/project-report-project.entity'
import {
  ReportProjectFile,
  ReportProjectFileKind,
} from './entities/report-project-file.entity'

const DEFAULT_PAYMENTS_STAGE_CODE = 'payments'
const DEFAULT_PAYMENTS_STAGE_TITLE = 'Оплаты'

export type ReportProjectUploadedFile = {
  originalname: string
  mimetype: string
  size: number
  buffer?: Buffer
}

@Injectable()
export class ProjectReportsService {
  constructor(
    @InjectRepository(ReportProject)
    private readonly projectsRepository: Repository<ReportProject>,
    @InjectRepository(ProjectGanttStage)
    private readonly stagesRepository: Repository<ProjectGanttStage>,
    @InjectRepository(ProjectGanttEvent)
    private readonly eventsRepository: Repository<ProjectGanttEvent>,
    @InjectRepository(ProjectPayment)
    private readonly paymentsRepository: Repository<ProjectPayment>,
    @InjectRepository(ReportProjectFile)
    private readonly projectFilesRepository: Repository<ReportProjectFile>,
    @InjectRepository(ProjectReportEntry)
    private readonly projectReportEntriesRepository: Repository<ProjectReportEntry>,
    @InjectRepository(ProjectReportEntryFile)
    private readonly projectReportEntryFilesRepository: Repository<ProjectReportEntryFile>,
  ) {}

  findProjects(): Promise<ReportProject[]> {
    return this.projectsRepository.find({
      relations: { files: true },
      order: { id: 'DESC' },
    })
  }

  async createProject(dto: CreateReportProjectDto): Promise<ReportProject> {
    const project = this.projectsRepository.create({
      ...dto,
      title: dto.title.trim(),
    })

    return this.projectsRepository.save(project)
  }

  findProject(projectId: number): Promise<ReportProject> {
    return this.findProjectOrFail(projectId)
  }

  async updateProject(
    projectId: number,
    dto: UpdateReportProjectDto,
  ): Promise<ReportProject> {
    const project = await this.findProjectOrFail(projectId)

    Object.assign(project, dto)

    if (dto.title !== undefined) {
      project.title = dto.title.trim()
    }

    return this.projectsRepository.save(project)
  }

  async deleteProject(projectId: number): Promise<void> {
    const project = await this.findProjectOrFail(projectId)

    await Promise.all(
      project.files.map((file) => this.deletePhysicalFile(file.storagePath)),
    )
    await this.projectsRepository.remove(project)
  }

  async addProjectFile(
    projectId: number,
    fileKind: ReportProjectFileKind,
    file: ReportProjectUploadedFile | undefined,
  ): Promise<ReportProjectFile> {
    if (!Object.values(ReportProjectFileKind).includes(fileKind)) {
      throw new BadRequestException('Invalid project file kind')
    }

    const project = await this.findProjectOrFail(projectId)

    if (!file?.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const existingFile = project.files.find(
      (item) => item.fileKind === fileKind,
    )

    if (existingFile) {
      await this.deleteProjectFile(projectId, existingFile.id)
    }

    const storagePath = await this.saveProjectFile(project.id, fileKind, file)
    const projectFile = this.projectFilesRepository.create({
      projectId: project.id,
      project,
      fileKind,
      originalName: this.normalizeUploadedFileName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath,
    })

    return this.projectFilesRepository.save(projectFile)
  }

  private normalizeUploadedFileName(originalName: string): string {
    try {
      const decoded = Buffer.from(originalName, 'latin1').toString('utf8')

      if (decoded && !decoded.includes('�')) {
        return decoded
      }

      return originalName
    } catch {
      return originalName
    }
  }

  async getProjectFile(
    projectId: number,
    fileId: number,
  ): Promise<{
    file: ReportProjectFile
    stream: ReturnType<typeof createReadStream>
  }> {
    const file = await this.projectFilesRepository.findOne({
      where: {
        id: fileId,
        projectId,
      },
    })

    if (!file) {
      throw new NotFoundException('Project file not found')
    }

    const absolutePath = this.getAbsoluteStoragePath(file.storagePath)

    try {
      const fileStat = await stat(absolutePath)

      if (!fileStat.isFile()) {
        throw new Error('Storage path is not a file')
      }

      await access(absolutePath)
    } catch {
      throw new NotFoundException('Project file not found on disk')
    }

    return {
      file,
      stream: createReadStream(absolutePath),
    }
  }

  async deleteProjectFile(projectId: number, fileId: number): Promise<void> {
    const file = await this.projectFilesRepository.findOne({
      where: {
        id: fileId,
        projectId,
      },
    })

    if (!file) {
      throw new NotFoundException('Project file not found')
    }

    await this.deletePhysicalFile(file.storagePath)
    await this.projectFilesRepository.remove(file)
  }

  async findProjectReportEntries(projectId: number): Promise<ProjectReportEntry[]> {
    await this.findProjectOrFail(projectId)

    return this.projectReportEntriesRepository.find({
      where: { projectId },
      relations: { files: true },
      order: { reportDate: 'DESC', createdAt: 'DESC', id: 'DESC' },
    })
  }

  async createProjectReportEntry(
    projectId: number,
    dto: CreateProjectReportEntryDto,
  ): Promise<ProjectReportEntry> {
    const project = await this.findProjectOrFail(projectId)
    const text = dto.text.trim()
    const authorName = dto.authorName.trim()

    if (!text) {
      throw new BadRequestException('Текст отчёта обязателен')
    }

    if (!authorName) {
      throw new BadRequestException('Автор отчёта обязателен')
    }

    const reportEntry = this.projectReportEntriesRepository.create({
      projectId: project.id,
      project,
      authorId: dto.authorId?.trim() || null,
      authorName,
      text,
      reportDate: this.getCurrentDate(),
      nextReportDate: dto.nextReportDate ?? null,
    })

    return this.projectReportEntriesRepository.save(reportEntry)
  }

  async updateProjectReportEntry(
    projectId: number,
    reportId: number,
    dto: UpdateProjectReportEntryDto,
  ): Promise<ProjectReportEntry> {
    const reportEntry = await this.findReportEntryForProject(projectId, reportId)

    if (dto.authorName !== undefined) {
      const authorName = dto.authorName.trim()

      if (!authorName) {
        throw new BadRequestException('РђРІС‚РѕСЂ РѕС‚С‡С‘С‚Р° РѕР±СЏР·Р°С‚РµР»РµРЅ')
      }

      reportEntry.authorName = authorName
    }

    if (dto.authorId !== undefined) {
      reportEntry.authorId = dto.authorId?.trim() || null
    }

    if (dto.text !== undefined) {
      const text = dto.text.trim()

      if (!text) {
        throw new BadRequestException('РўРµРєСЃС‚ РѕС‚С‡С‘С‚Р° РѕР±СЏР·Р°С‚РµР»РµРЅ')
      }

      reportEntry.text = text
    }

    if (dto.nextReportDate !== undefined) {
      reportEntry.nextReportDate = dto.nextReportDate ?? null
    }

    await this.projectReportEntriesRepository.save(reportEntry)

    return this.findReportEntryForProject(projectId, reportId)
  }

  async deleteProjectReportEntry(
    projectId: number,
    reportId: number,
  ): Promise<void> {
    const reportEntry = await this.findReportEntryForProject(projectId, reportId)

    await Promise.all(
      reportEntry.files.map((file) => this.deletePhysicalFile(file.path)),
    )
    await this.projectReportEntriesRepository.remove(reportEntry)
  }

  async addProjectReportEntryFile(
    projectId: number,
    reportId: number,
    file: ReportProjectUploadedFile | undefined,
  ): Promise<ProjectReportEntryFile> {
    const reportEntry = await this.findReportEntryForProject(projectId, reportId)

    if (!file?.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const { path, storedName } = await this.saveReportEntryFile(reportId, file)
    const reportEntryFile = this.projectReportEntryFilesRepository.create({
      reportEntryId: reportEntry.id,
      reportEntry,
      originalName: this.normalizeUploadedFileName(file.originalname),
      storedName,
      mimeType: file.mimetype,
      size: file.size,
      path,
    })

    return this.projectReportEntryFilesRepository.save(reportEntryFile)
  }

  async getProjectReportEntryFile(
    projectId: number,
    reportId: number,
    fileId: number,
  ): Promise<{
    file: ProjectReportEntryFile
    stream: ReturnType<typeof createReadStream>
  }> {
    const file = await this.findReportEntryFileForProject(
      projectId,
      reportId,
      fileId,
    )
    const absolutePath = this.getAbsoluteStoragePath(file.path)

    try {
      const fileStat = await stat(absolutePath)

      if (!fileStat.isFile()) {
        throw new Error('Storage path is not a file')
      }

      await access(absolutePath)
    } catch {
      throw new NotFoundException('Report file not found on disk')
    }

    return {
      file,
      stream: createReadStream(absolutePath),
    }
  }

  async deleteProjectReportEntryFile(
    projectId: number,
    reportId: number,
    fileId: number,
  ): Promise<void> {
    const file = await this.findReportEntryFileForProject(
      projectId,
      reportId,
      fileId,
    )

    await this.deletePhysicalFile(file.path)
    await this.projectReportEntryFilesRepository.remove(file)
  }

  async findProjectStages(projectId: string): Promise<ProjectGanttStage[]> {
    await this.ensurePaymentsStage(projectId)

    return this.stagesRepository.find({
      where: { projectId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    })
  }

  async createProjectStage(
    projectId: string,
    dto: CreateProjectGanttStageDto,
  ): Promise<ProjectGanttStage> {
    const code = this.normalizeCode(dto.code)
    await this.assertStageCodeAvailable(projectId, code)

    const stage = this.stagesRepository.create({
      projectId,
      title: dto.title.trim(),
      code,
      sortOrder: dto.sortOrder ?? 0,
      isDefault: false,
    })

    return this.stagesRepository.save(stage)
  }

  async updateStage(
    stageId: number,
    dto: UpdateProjectGanttStageDto,
  ): Promise<ProjectGanttStage> {
    const stage = await this.findStageOrFail(stageId)

    if (stage.code === DEFAULT_PAYMENTS_STAGE_CODE && dto.code) {
      throw new BadRequestException(
        'Нельзя изменить код системного этапа оплат',
      )
    }

    if (dto.title !== undefined) {
      stage.title = dto.title.trim()
    }

    if (dto.code !== undefined) {
      const code = this.normalizeCode(dto.code)
      await this.assertStageCodeAvailable(stage.projectId, code, stage.id)
      stage.code = code
    }

    if (dto.sortOrder !== undefined) {
      stage.sortOrder = dto.sortOrder ?? 0
    }

    return this.stagesRepository.save(stage)
  }

  async deleteStage(stageId: number): Promise<void> {
    const stage = await this.findStageOrFail(stageId)

    if (stage.code === DEFAULT_PAYMENTS_STAGE_CODE) {
      throw new BadRequestException('Нельзя удалить системный этап оплат')
    }

    const [eventsCount, paymentsCount] = await Promise.all([
      this.eventsRepository.count({ where: { stageId } }),
      this.paymentsRepository.count({ where: { stageId } }),
    ])

    if (eventsCount > 0 || paymentsCount > 0) {
      throw new BadRequestException(
        'Нельзя удалить этап со связанными событиями или оплатами',
      )
    }

    await this.stagesRepository.delete(stageId)
  }

  async findProjectEvents(projectId: string): Promise<ProjectGanttEvent[]> {
    return this.eventsRepository.find({
      where: { projectId },
      relations: { stage: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    })
  }

  async createProjectEvent(
    projectId: string,
    dto: CreateProjectGanttEventDto,
  ): Promise<ProjectGanttEvent> {
    await this.assertStageBelongsToProject(dto.stageId, projectId)
    this.validateEventDates(dto)

    const event = this.eventsRepository.create({
      projectId,
      stageId: dto.stageId,
      title: dto.title.trim(),
      eventKind: dto.eventKind,
      planStartDate: dto.planStartDate ?? null,
      planEndDate: dto.planEndDate ?? null,
      factStartDate: dto.factStartDate ?? null,
      factEndDate: dto.factEndDate ?? null,
      sortOrder: dto.sortOrder ?? 0,
    })

    return this.eventsRepository.save(event)
  }

  async updateEvent(
    eventId: number,
    dto: UpdateProjectGanttEventDto,
  ): Promise<ProjectGanttEvent> {
    const event = await this.findEventOrFail(eventId)

    if (dto.stageId !== undefined) {
      await this.assertStageBelongsToProject(dto.stageId, event.projectId)
      event.stageId = dto.stageId
    }

    const nextEventKind = dto.eventKind ?? event.eventKind
    this.validateEventDates({
      eventKind: nextEventKind,
      planStartDate: dto.planStartDate ?? event.planStartDate,
      planEndDate: dto.planEndDate ?? event.planEndDate,
      factStartDate: dto.factStartDate ?? event.factStartDate,
      factEndDate: dto.factEndDate ?? event.factEndDate,
    })

    if (dto.title !== undefined) {
      event.title = dto.title.trim()
    }

    if (dto.eventKind !== undefined) {
      event.eventKind = dto.eventKind
    }

    if (dto.planStartDate !== undefined) {
      event.planStartDate = dto.planStartDate
    }

    if (dto.planEndDate !== undefined) {
      event.planEndDate = dto.planEndDate
    }

    if (dto.factStartDate !== undefined) {
      event.factStartDate = dto.factStartDate
    }

    if (dto.factEndDate !== undefined) {
      event.factEndDate = dto.factEndDate
    }

    if (dto.sortOrder !== undefined) {
      event.sortOrder = dto.sortOrder ?? 0
    }

    return this.eventsRepository.save(event)
  }

  async deleteEvent(eventId: number): Promise<void> {
    await this.findEventOrFail(eventId)
    await this.eventsRepository.delete(eventId)
  }

  async findProjectPayments(projectId: string): Promise<ProjectPayment[]> {
    return this.paymentsRepository.find({
      where: { projectId },
      relations: { stage: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    })
  }

  async createProjectPayment(
    projectId: string,
    dto: CreateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    await this.assertStageBelongsToProject(dto.stageId, projectId)

    const payment = this.paymentsRepository.create({
      projectId,
      stageId: dto.stageId,
      status: dto.status,
      paymentDate: dto.paymentDate ?? null,
      percent: dto.percent ?? null,
      amount: dto.amount ?? null,
      waitingDays: dto.waitingDays ?? null,
      sortOrder: dto.sortOrder ?? 0,
    })

    return this.paymentsRepository.save(payment)
  }

  async updatePayment(
    paymentId: number,
    dto: UpdateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    const payment = await this.findPaymentOrFail(paymentId)

    if (dto.stageId !== undefined) {
      await this.assertStageBelongsToProject(dto.stageId, payment.projectId)
      payment.stageId = dto.stageId
    }

    if (dto.status !== undefined) {
      payment.status = dto.status
    }

    if (dto.paymentDate !== undefined) {
      payment.paymentDate = dto.paymentDate
    }

    if (dto.percent !== undefined) {
      payment.percent = dto.percent
    }

    if (dto.amount !== undefined) {
      payment.amount = dto.amount
    }

    if (dto.waitingDays !== undefined) {
      payment.waitingDays = dto.waitingDays
    }

    if (dto.sortOrder !== undefined) {
      payment.sortOrder = dto.sortOrder ?? 0
    }

    return this.paymentsRepository.save(payment)
  }

  async deletePayment(paymentId: number): Promise<void> {
    await this.findPaymentOrFail(paymentId)
    await this.paymentsRepository.delete(paymentId)
  }

  private async saveProjectFile(
    projectId: number,
    fileKind: ReportProjectFileKind,
    file: ReportProjectUploadedFile,
  ): Promise<string> {
    if (!file.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const fileName = `${Date.now()}-${randomUUID()}-${this.sanitizeFileName(
      file.originalname,
    )}`
    const relativePath = posix.join(
      'uploads',
      'report-projects',
      String(projectId),
      fileKind,
      fileName,
    )
    const uploadDir = join(
      process.cwd(),
      'uploads',
      'report-projects',
      String(projectId),
      fileKind,
    )

    await mkdir(uploadDir, { recursive: true })
    await writeFile(join(uploadDir, fileName), file.buffer)

    return relativePath
  }

  private async saveReportEntryFile(
    reportId: number,
    file: ReportProjectUploadedFile,
  ): Promise<{ path: string; storedName: string }> {
    if (!file.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const storedName = `${Date.now()}-${randomUUID()}-${this.sanitizeFileName(
      file.originalname,
    )}`
    const path = posix.join(
      'uploads',
      'project-report-entries',
      String(reportId),
      storedName,
    )
    const uploadDir = join(
      process.cwd(),
      'uploads',
      'project-report-entries',
      String(reportId),
    )

    await mkdir(uploadDir, { recursive: true })
    await writeFile(join(uploadDir, storedName), file.buffer)

    return { path, storedName }
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Zа-яА-ЯёЁ0-9._ -]/g, '_')
  }

  private getAbsoluteStoragePath(storagePath: string): string {
    return join(process.cwd(), storagePath)
  }

  private async deletePhysicalFile(storagePath: string): Promise<void> {
    await rm(this.getAbsoluteStoragePath(storagePath), { force: true })
  }

  private getCurrentDate(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private async findReportEntryForProject(projectId: number, reportId: number) {
    const reportEntry = await this.projectReportEntriesRepository.findOne({
      where: {
        id: reportId,
        projectId,
      },
      relations: { files: true },
    })

    if (!reportEntry) {
      throw new NotFoundException('Project report not found')
    }

    return reportEntry
  }

  private async findReportEntryFileForProject(
    projectId: number,
    reportId: number,
    fileId: number,
  ) {
    const file = await this.projectReportEntryFilesRepository.findOne({
      where: {
        id: fileId,
        reportEntryId: reportId,
        reportEntry: {
          id: reportId,
          projectId,
        },
      },
      relations: { reportEntry: true },
    })

    if (!file) {
      throw new NotFoundException('Project report file not found')
    }

    return file
  }

  private async ensurePaymentsStage(projectId: string) {
    const existingStage = await this.stagesRepository.findOne({
      where: { projectId, code: DEFAULT_PAYMENTS_STAGE_CODE },
    })

    if (existingStage) {
      return existingStage
    }

    return this.stagesRepository.save(
      this.stagesRepository.create({
        projectId,
        title: DEFAULT_PAYMENTS_STAGE_TITLE,
        code: DEFAULT_PAYMENTS_STAGE_CODE,
        sortOrder: 0,
        isDefault: true,
      }),
    )
  }

  private async findProjectOrFail(projectId: number) {
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
      relations: { files: true },
    })

    if (!project) {
      throw new NotFoundException('Project not found')
    }

    return project
  }
  private async findStageOrFail(stageId: number) {
    const stage = await this.stagesRepository.findOne({
      where: { id: stageId },
    })

    if (!stage) {
      throw new NotFoundException('Этап не найден')
    }

    return stage
  }

  private async findEventOrFail(eventId: number) {
    const event = await this.eventsRepository.findOne({
      where: { id: eventId },
    })

    if (!event) {
      throw new NotFoundException('Событие не найдено')
    }

    return event
  }

  private async findPaymentOrFail(paymentId: number) {
    const payment = await this.paymentsRepository.findOne({
      where: { id: paymentId },
    })

    if (!payment) {
      throw new NotFoundException('Оплата не найдена')
    }

    return payment
  }

  private async assertStageBelongsToProject(
    stageId: number,
    projectId: string,
  ) {
    const stage = await this.stagesRepository.findOne({
      where: { id: stageId },
    })

    if (!stage || stage.projectId !== projectId) {
      throw new BadRequestException('Этап не принадлежит проекту')
    }
  }

  private async assertStageCodeAvailable(
    projectId: string,
    code: string,
    excludeStageId?: number,
  ) {
    const existingStage = await this.stagesRepository.findOne({
      where: { projectId, code },
    })

    if (existingStage && existingStage.id !== excludeStageId) {
      throw new BadRequestException('Этап с таким кодом уже существует')
    }
  }

  private normalizeCode(code: string) {
    const normalizedCode = code.trim()

    if (!normalizedCode) {
      throw new BadRequestException('Код этапа обязателен')
    }

    return normalizedCode
  }

  private validateEventDates({
    eventKind,
    planStartDate,
    planEndDate,
    factStartDate,
    factEndDate,
  }: {
    eventKind: ProjectGanttEventKind
    planStartDate?: string | null
    planEndDate?: string | null
    factStartDate?: string | null
    factEndDate?: string | null
  }) {
    if (
      eventKind === ProjectGanttEventKind.Duration &&
      (!planStartDate || !planEndDate)
    ) {
      throw new BadRequestException(
        'Для события с продолжительностью нужен плановый период',
      )
    }

    if (planStartDate && planEndDate && planStartDate > planEndDate) {
      throw new BadRequestException(
        'Дата начала плана не может быть позже даты окончания',
      )
    }

    if (factStartDate && factEndDate && factStartDate > factEndDate) {
      throw new BadRequestException(
        'Дата начала факта не может быть позже даты окончания',
      )
    }
  }
}
