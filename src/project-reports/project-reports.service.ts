import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateProjectGanttEventDto } from './dto/create-project-gantt-event.dto'
import { CreateProjectGanttStageDto } from './dto/create-project-gantt-stage.dto'
import { CreateProjectPaymentDto } from './dto/create-project-payment.dto'
import { CreateProjectReportProjectDto } from './dto/create-project-report-project.dto'
import { UpdateProjectGanttEventDto } from './dto/update-project-gantt-event.dto'
import { UpdateProjectGanttStageDto } from './dto/update-project-gantt-stage.dto'
import { UpdateProjectPaymentDto } from './dto/update-project-payment.dto'
import { UpdateProjectReportProjectDto } from './dto/update-project-report-project.dto'
import {
  ProjectGanttEvent,
  ProjectGanttEventKind,
} from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ProjectReportProject } from './entities/project-report-project.entity'

const DEFAULT_PAYMENTS_STAGE_CODE = 'payments'
const DEFAULT_PAYMENTS_STAGE_TITLE = 'Оплаты'

@Injectable()
export class ProjectReportsService {
  constructor(
    @InjectRepository(ProjectReportProject)
    private readonly projectsRepository: Repository<ProjectReportProject>,
    @InjectRepository(ProjectGanttStage)
    private readonly stagesRepository: Repository<ProjectGanttStage>,
    @InjectRepository(ProjectGanttEvent)
    private readonly eventsRepository: Repository<ProjectGanttEvent>,
    @InjectRepository(ProjectPayment)
    private readonly paymentsRepository: Repository<ProjectPayment>,
  ) {}

  findProjects(): Promise<ProjectReportProject[]> {
    return this.projectsRepository.find({
      order: { id: 'DESC' },
    })
  }

  async createProject(
    dto: CreateProjectReportProjectDto,
  ): Promise<ProjectReportProject> {
    const project = this.projectsRepository.create({
      ...dto,
      title: dto.title.trim(),
    })

    return this.projectsRepository.save(project)
  }

  findProject(projectId: number): Promise<ProjectReportProject> {
    return this.findProjectOrFail(projectId)
  }

  async updateProject(
    projectId: number,
    dto: UpdateProjectReportProjectDto,
  ): Promise<ProjectReportProject> {
    const project = await this.findProjectOrFail(projectId)

    Object.assign(project, dto)

    if (dto.title !== undefined) {
      project.title = dto.title.trim()
    }

    return this.projectsRepository.save(project)
  }

  async deleteProject(projectId: number): Promise<void> {
    await this.findProjectOrFail(projectId)
    await this.projectsRepository.delete(projectId)
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
      throw new BadRequestException('Нельзя изменить код системного этапа оплат')
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
      throw new BadRequestException('Нельзя удалить этап со связанными событиями или оплатами')
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
    })

    if (!project) {
      throw new NotFoundException('Project not found')
    }

    return project
  }
  private async findStageOrFail(stageId: number) {
    const stage = await this.stagesRepository.findOne({ where: { id: stageId } })

    if (!stage) {
      throw new NotFoundException('Этап не найден')
    }

    return stage
  }

  private async findEventOrFail(eventId: number) {
    const event = await this.eventsRepository.findOne({ where: { id: eventId } })

    if (!event) {
      throw new NotFoundException('Событие не найдено')
    }

    return event
  }

  private async findPaymentOrFail(paymentId: number) {
    const payment = await this.paymentsRepository.findOne({ where: { id: paymentId } })

    if (!payment) {
      throw new NotFoundException('Оплата не найдена')
    }

    return payment
  }

  private async assertStageBelongsToProject(stageId: number, projectId: string) {
    const stage = await this.stagesRepository.findOne({ where: { id: stageId } })

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
    if (eventKind === ProjectGanttEventKind.Duration && (!planStartDate || !planEndDate)) {
      throw new BadRequestException('Для события с продолжительностью нужен плановый период')
    }

    if (planStartDate && planEndDate && planStartDate > planEndDate) {
      throw new BadRequestException('Дата начала плана не может быть позже даты окончания')
    }

    if (factStartDate && factEndDate && factStartDate > factEndDate) {
      throw new BadRequestException('Дата начала факта не может быть позже даты окончания')
    }
  }
}
