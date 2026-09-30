import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateProjectGanttEventDto } from './dto/create-project-gantt-event.dto'
import { CreateProjectGanttStageDto } from './dto/create-project-gantt-stage.dto'
import { UpdateProjectGanttEventDto } from './dto/update-project-gantt-event.dto'
import { UpdateProjectGanttStageDto } from './dto/update-project-gantt-stage.dto'
import {
  ProjectGanttEvent,
  ProjectGanttEventKind,
} from './entities/project-gantt-event.entity'
import {
  ProjectGanttDependencyAnchor,
  ProjectGanttGroupStatus,
  ProjectGanttStage,
  ProjectGanttStageType,
} from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'

const DEFAULT_PAYMENTS_STAGE_CODE = 'payments'
const DEFAULT_PAYMENTS_STAGE_TITLE = 'Оплаты'

const STAGE_TYPE_TITLES: Record<ProjectGanttStageType, string> = {
  [ProjectGanttStageType.Payments]: DEFAULT_PAYMENTS_STAGE_TITLE,
  [ProjectGanttStageType.TzWriting]: 'Написание ТЗ',
  [ProjectGanttStageType.TzSigning]: 'Подписание ТЗ',
  [ProjectGanttStageType.Contracting]: 'Контрактация',
  [ProjectGanttStageType.Development]: 'Разработка',
  [ProjectGanttStageType.Education]: 'Обучение',
  [ProjectGanttStageType.Delivery]: 'Сдача',
  [ProjectGanttStageType.Closing]: 'Закрытие проекта',
}

const DURATION_STAGE_TYPES = new Set<ProjectGanttStageType>([
  ProjectGanttStageType.TzWriting,
  ProjectGanttStageType.Development,
  ProjectGanttStageType.Education,
])

@Injectable()
export class ProjectGanttService {
  constructor(
    @InjectRepository(ProjectGanttStage)
    private readonly stagesRepository: Repository<ProjectGanttStage>,
    @InjectRepository(ProjectGanttEvent)
    private readonly eventsRepository: Repository<ProjectGanttEvent>,
    @InjectRepository(ProjectPayment)
    private readonly paymentsRepository: Repository<ProjectPayment>,
  ) {}

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
    this.assertPlannedHours(dto.plannedHours)
    const isGroup = dto.isGroup ?? false
    this.assertGroupFields(dto, isGroup)
    const stageType = dto.stageType ?? null
    this.assertStageTypeAllowedForManualStage(stageType)

    const code = dto.code?.trim()
      ? this.normalizeCode(dto.code)
      : await this.createUniqueStageCode(projectId, stageType)

    await this.assertStageCodeAvailable(projectId, code)
    if (!isGroup) {
      await this.assertDependsOnStageBelongsToProject(
        dto.dependsOnStageId,
        projectId,
      )
      await this.assertParentStage(dto.parentStageId, projectId)
    }

    const stage = await this.stagesRepository.save(
      this.stagesRepository.create({
        projectId,
        title: this.getStageTitle(dto.title, stageType, code),
        code,
        stageType,
        dependsOnStageId: isGroup ? null : (dto.dependsOnStageId ?? null),
        dependencyAnchor:
          !isGroup && dto.dependsOnStageId
            ? (dto.dependencyAnchor ?? ProjectGanttDependencyAnchor.StageEnd)
            : null,
        plannedHours: dto.plannedHours ?? null,
        durationDays: isGroup ? null : (dto.durationDays ?? null),
        sortOrder: dto.sortOrder ?? 0,
        isDefault: false,
        isGroup,
        groupStatus: dto.groupStatus ?? ProjectGanttGroupStatus.NotStarted,
        parentStageId: isGroup ? null : (dto.parentStageId ?? null),
      }),
    )

    await this.ensureStageEvent(stage)

    return stage
  }

  async updateStage(
    stageId: number,
    dto: UpdateProjectGanttStageDto,
  ): Promise<ProjectGanttStage> {
    const stage = await this.findStageOrFail(stageId)
    this.assertPlannedHours(dto.plannedHours)
    if (stage.code === DEFAULT_PAYMENTS_STAGE_CODE &&
        (dto.plannedHours !== undefined || dto.groupStatus !== undefined)) {
      throw new BadRequestException('Плановые часы и статус работ не относятся к строке оплат')
    }

    if (dto.isGroup !== undefined && dto.isGroup !== stage.isGroup) {
      throw new BadRequestException(
        'Stage type cannot be changed between group and regular',
      )
    }

    this.assertGroupFields(dto, stage.isGroup)

    if (stage.code === DEFAULT_PAYMENTS_STAGE_CODE && dto.code) {
      throw new BadRequestException(
        'Нельзя изменить код системного этапа оплат',
      )
    }

    if (dto.stageType === ProjectGanttStageType.Payments) {
      throw new BadRequestException(
        'Системный этап оплат создаётся автоматически',
      )
    }

    if (dto.code !== undefined) {
      const code = this.normalizeCode(dto.code)
      await this.assertStageCodeAvailable(stage.projectId, code, stage.id)
      stage.code = code
    }

    if (dto.stageType !== undefined) {
      stage.stageType = dto.stageType ?? null
    }

    if (dto.groupStatus !== undefined) {
      stage.groupStatus = dto.groupStatus
    }

    if (dto.dependsOnStageId !== undefined) {
      await this.assertDependsOnStageBelongsToProject(
        dto.dependsOnStageId,
        stage.projectId,
        stage.id,
      )
      stage.dependsOnStageId = dto.dependsOnStageId ?? null
    }

    if (
      dto.dependencyAnchor !== undefined ||
      dto.dependsOnStageId !== undefined
    ) {
      stage.dependencyAnchor = stage.dependsOnStageId
        ? (dto.dependencyAnchor ??
          stage.dependencyAnchor ??
          ProjectGanttDependencyAnchor.StageEnd)
        : null
    }

    if (dto.plannedHours !== undefined) {
      stage.plannedHours = dto.plannedHours
    }

    if (dto.durationDays !== undefined) {
      stage.durationDays = dto.durationDays ?? null
    }

    if (dto.title !== undefined || dto.stageType !== undefined) {
      stage.title = this.getStageTitle(dto.title, stage.stageType, stage.code)
    }

    if (dto.sortOrder !== undefined) {
      stage.sortOrder = dto.sortOrder ?? 0
    }

    const savedStage = await this.stagesRepository.save(stage)
    // An hours/status edit must not change dates, events, child statuses or payments.
    if (dto.title !== undefined || dto.stageType !== undefined || dto.sortOrder !== undefined) {
      await this.ensureStageEvent(savedStage)
    }

    return savedStage
  }

  async deleteStage(stageId: number): Promise<void> {
    const stage = await this.findStageOrFail(stageId)

    if (stage.code === DEFAULT_PAYMENTS_STAGE_CODE) {
      throw new BadRequestException('Нельзя удалить системный этап оплат')
    }

    if (stage.isGroup) {
      const childrenCount = await this.stagesRepository.count({
        where: { parentStageId: stageId },
      })

      if (childrenCount > 0) {
        throw new BadRequestException(
          'Cannot delete a parent stage while it has child stages',
        )
      }
    }

    const paymentsCount = await this.paymentsRepository.count({
      where: { stageId },
    })

    if (paymentsCount > 0) {
      throw new BadRequestException(
        'Нельзя удалить этап со связанными оплатами',
      )
    }

    await this.eventsRepository.delete({ stageId })
    await this.stagesRepository.delete(stageId)
  }

  moveStageParent(
    stageId: number,
    parentStageId: number,
    beforeStageId?: number | null,
  ): Promise<ProjectGanttStage[]> {
    return this.stagesRepository.manager.transaction(async (manager) => {
      const stagesRepository = manager.getRepository(ProjectGanttStage)
      const stage = await stagesRepository.findOneBy({ id: stageId })

      if (
        !stage ||
        stage.isGroup ||
        stage.code === DEFAULT_PAYMENTS_STAGE_CODE
      ) {
        throw new BadRequestException(
          'Only a regular non-payment stage can be moved',
        )
      }

      const parent = await stagesRepository.findOneBy({ id: parentStageId })
      if (!parent || !parent.isGroup || parent.projectId !== stage.projectId) {
        throw new BadRequestException(
          'Target parent stage must be a group in the same project',
        )
      }

      const allStages = await stagesRepository.find({
        where: { projectId: stage.projectId },
        order: { sortOrder: 'ASC', id: 'ASC' },
      })

      const stagesWithoutCurrent = allStages.filter(
        (s) => String(s.id) !== String(stage.id),
      )

      stage.parentStageId = parent.id

      let targetIndex = -1
      if (beforeStageId !== undefined && beforeStageId !== null) {
        const beforeIndex = stagesWithoutCurrent.findIndex(
          (s) =>
            String(s.id) === String(beforeStageId) &&
            String(s.parentStageId) === String(parent.id),
        )
        if (beforeIndex !== -1) {
          targetIndex = beforeIndex
        } else {
          throw new BadRequestException(
            'beforeStageId must be a child of the target parent stage',
          )
        }
      }

      if (targetIndex === -1) {
        const lastChildIndex = stagesWithoutCurrent.findLastIndex(
          (s) => String(s.parentStageId) === String(parent.id),
        )
        targetIndex =
          lastChildIndex !== -1
            ? lastChildIndex + 1
            : stagesWithoutCurrent.findIndex(
                  (s) => String(s.id) === String(parent.id),
                ) + 1
      }

      stagesWithoutCurrent.splice(targetIndex, 0, stage)

      stagesWithoutCurrent.forEach((s, idx) => (s.sortOrder = idx))

      await stagesRepository.save(stagesWithoutCurrent)
      return stagesWithoutCurrent
    })
  }

  findProjectEvents(projectId: string): Promise<ProjectGanttEvent[]> {
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
    await this.assertRegularStageBelongsToProject(dto.stageId, projectId)
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
      await this.assertRegularStageBelongsToProject(
        dto.stageId,
        event.projectId,
      )
      event.stageId = dto.stageId
    }

    const nextEventKind = dto.eventKind ?? event.eventKind
    this.validateEventDates({
      eventKind: nextEventKind,
      // Null explicitly clears a date; only an omitted field keeps its value.
      planStartDate: dto.planStartDate !== undefined ? dto.planStartDate : event.planStartDate,
      planEndDate: dto.planEndDate !== undefined ? dto.planEndDate : event.planEndDate,
      factStartDate: dto.factStartDate !== undefined ? dto.factStartDate : event.factStartDate,
      factEndDate: dto.factEndDate !== undefined ? dto.factEndDate : event.factEndDate,
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

  private async ensurePaymentsStage(projectId: string) {
    const existingStage = await this.stagesRepository.findOne({
      where: { projectId, code: DEFAULT_PAYMENTS_STAGE_CODE },
    })

    if (existingStage) {
      if (
        existingStage.title !== DEFAULT_PAYMENTS_STAGE_TITLE ||
        existingStage.stageType !== ProjectGanttStageType.Payments
      ) {
        existingStage.title = DEFAULT_PAYMENTS_STAGE_TITLE
        existingStage.stageType = ProjectGanttStageType.Payments
        return this.stagesRepository.save(existingStage)
      }

      return existingStage
    }

    return this.stagesRepository.save(
      this.stagesRepository.create({
        projectId,
        title: DEFAULT_PAYMENTS_STAGE_TITLE,
        code: DEFAULT_PAYMENTS_STAGE_CODE,
        stageType: ProjectGanttStageType.Payments,
        sortOrder: 0,
        isDefault: true,
        isGroup: false,
        parentStageId: null,
      }),
    )
  }

  private async ensureStageEvent(stage: ProjectGanttStage) {
    if (stage.isGroup) {
      return
    }
    const eventKind = this.getEventKindByStageType(stage.stageType)

    if (!eventKind) {
      return
    }

    const event = await this.eventsRepository.findOne({
      where: { stageId: stage.id },
      order: { id: 'ASC' },
    })

    if (!event) {
      await this.eventsRepository.save(
        this.eventsRepository.create({
          projectId: stage.projectId,
          stageId: stage.id,
          title: stage.title,
          eventKind,
          planStartDate: null,
          planEndDate: null,
          factStartDate: null,
          factEndDate: null,
          sortOrder: stage.sortOrder,
        }),
      )
      return
    }

    event.title = stage.title
    event.eventKind = eventKind
    event.sortOrder = stage.sortOrder
    await this.eventsRepository.save(event)
  }

  private getEventKindByStageType(stageType: ProjectGanttStageType | null) {
    if (!stageType || stageType === ProjectGanttStageType.Payments) {
      return null
    }

    return DURATION_STAGE_TYPES.has(stageType)
      ? ProjectGanttEventKind.Duration
      : ProjectGanttEventKind.OneTime
  }

  private getStageTitle(
    title: string | null | undefined,
    stageType: ProjectGanttStageType | null,
    fallback: string,
  ) {
    const trimmedTitle = title?.trim()

    if (trimmedTitle) {
      return trimmedTitle
    }

    return stageType ? STAGE_TYPE_TITLES[stageType] : fallback
  }

  private assertStageTypeAllowedForManualStage(
    stageType: ProjectGanttStageType | null,
  ) {
    if (stageType === ProjectGanttStageType.Payments) {
      throw new BadRequestException(
        'Системный этап оплат создаётся автоматически',
      )
    }
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

  private async assertDependsOnStageBelongsToProject(
    dependsOnStageId: number | null | undefined,
    projectId: string,
    currentStageId?: number,
  ) {
    if (!dependsOnStageId) {
      return
    }

    if (dependsOnStageId === currentStageId) {
      throw new BadRequestException('Этап не может быть привязан сам к себе')
    }

    await this.assertRegularStageBelongsToProject(dependsOnStageId, projectId)
  }

  private async assertRegularStageBelongsToProject(
    stageId: number,
    projectId: string,
  ) {
    const stage = await this.findStageOrFail(stageId)

    if (stage.projectId !== projectId || stage.isGroup) {
      throw new BadRequestException(
        'Stage must be a regular stage in the same project',
      )
    }
  }

  private async assertParentStage(
    parentStageId: number | null | undefined,
    projectId: string,
  ) {
    if (!parentStageId) {
      return
    }

    const parent = await this.findStageOrFail(parentStageId)

    if (!parent.isGroup || parent.projectId !== projectId) {
      throw new BadRequestException(
        'Parent stage must be a group in the same project',
      )
    }
  }

  private assertGroupFields(
    dto: CreateProjectGanttStageDto | UpdateProjectGanttStageDto,
    isGroup: boolean,
  ) {
    if (isGroup) {
      if (
        dto.dependsOnStageId != null ||
        dto.dependencyAnchor != null ||
        dto.durationDays != null ||
        ('parentStageId' in dto && dto.parentStageId != null)
      ) {
        throw new BadRequestException(
          'A parent stage cannot have dependency, duration, or parent',
        )
      }
      return
    }

    // The legacy field name is retained for API compatibility. Both a stage and
    // a substage now have an independently user-controlled completion status.
  }

  private assertPlannedHours(value: number | null | undefined): void {
    if (value == null) return
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 ||
        Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
      throw new BadRequestException('Плановые часы: число от 0 до 1000000, не более двух знаков после запятой')
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

  private async createUniqueStageCode(
    projectId: string,
    stageType: ProjectGanttStageType | null,
  ) {
    const baseCode = stageType ?? 'stage'
    let code = baseCode
    let index = 2

    while (await this.stagesRepository.exists({ where: { projectId, code } })) {
      code = `${baseCode}-${index}`
      index += 1
    }

    return code
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
      (planStartDate || planEndDate) &&
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
