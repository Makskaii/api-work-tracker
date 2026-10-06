import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { DataSource, type QueryRunner } from 'typeorm'
import { EntityTypeIds, FinancialProjectType, ProjectCodes } from '../constants/const'
import { BitrixItemCreateRejectedException, BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import type { CreateReportProjectDto } from './dto/create-project-report-project.dto'
import { ReportProject, ReportProjectType } from './entities/project-report-project.entity'
import { bitrixProjectLockName } from './project-bitrix-lock'

type BitrixProject = {
  id?: unknown
  title?: unknown
  xmlId?: unknown
  [ProjectCodes.company]?: unknown
}

type BitrixCompany = { ID?: unknown; id?: unknown; TITLE?: unknown; title?: unknown }
type CreationAttempt = { project_title: string; company_id: string }

export type ProjectCompanyLink = {
  bitrixProjectId: string
  clientCompanyId: string
  clientCompany: string
  title: string
}

/** Keep external project creation recoverable without deleting CRM cards on DB errors. */
@Injectable()
export class ProjectBitrixService {
  constructor(
    private readonly bitrixService: BitrixService,
    private readonly dataSource: DataSource,
  ) {}

  positiveId(value: unknown, field: string): string {
    if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
      throw new BadRequestException(`Некорректный идентификатор ${field}`)
    }
    return String(Number(value))
  }

  optionalProjectId(value: unknown): string | null {
    return value == null || value === '' ? null : this.positiveId(value, 'проекта Битрикс24')
  }

  async resolveCompany(value: unknown): Promise<{ clientCompanyId: string; clientCompany: string }> {
    const clientCompanyId = this.positiveId(value, 'компании')
    const company = await this.bitrixService.getCompany<BitrixCompany>(Number(clientCompanyId))
    if (!company || typeof company !== 'object') {
      throw new NotFoundException('Компания не найдена в Битрикс24')
    }
    const returnedId = company.ID ?? company.id
    if (returnedId != null && this.positiveId(returnedId, 'компании') !== clientCompanyId) {
      throw new BadGatewayException('Битрикс24 вернул другую компанию')
    }
    const rawTitle = company.TITLE ?? company.title
    if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
      throw new NotFoundException('У компании в Битрикс24 отсутствует название')
    }
    return { clientCompanyId, clientCompany: rawTitle.trim() }
  }

  async resolveProjectLink(value: unknown): Promise<ProjectCompanyLink> {
    const bitrixProjectId = this.positiveId(value, 'проекта Битрикс24')
    const item = await this.bitrixService.getItem<BitrixProject>({
      entityTypeId: EntityTypeIds.projects, id: Number(bitrixProjectId),
    })
    if (!item) throw new NotFoundException('Проект не найден в Битрикс24')
    const link = await this.readProject(item)
    if (link.bitrixProjectId !== bitrixProjectId) {
      throw new BadGatewayException('Битрикс24 вернул другой проект')
    }
    return link
  }

  async withProjectLock<T>(bitrixProjectId: string, operation: () => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner()
    const locks: string[] = []
    await runner.connect()
    try {
      await this.acquireLock(runner, bitrixProjectLockName(bitrixProjectId), locks)
      return await operation()
    } finally {
      try {
        for (const name of locks) await runner.query('SELECT RELEASE_LOCK(?) AS released', [name])
      } finally {
        await runner.release()
      }
    }
  }
  async createProject(dto: CreateReportProjectDto): Promise<ReportProject> {
    const title = this.projectTitle(dto.title)
    const selectedProjectId = this.optionalProjectId(dto.bitrixProjectId)
    if (!selectedProjectId && !dto.creationRequestId) {
      throw new BadRequestException('Обновите страницу перед созданием нового проекта')
    }
    const requestId = (dto.creationRequestId ?? randomUUID()).toLowerCase()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
      throw new BadRequestException('Некорректный запрос создания проекта')
    }
    const responsibleId = dto.responsibleId == null || dto.responsibleId === ''
      ? null : this.positiveId(dto.responsibleId, 'ответственного')
    const runner = this.dataSource.createQueryRunner()
    const locks: string[] = []
    await runner.connect()
    try {
      await this.acquireLock(runner, `work-tracker:project:${requestId}`, locks)
      const repository = runner.manager.getRepository(ReportProject)
      const completed = await repository.findOne({ where: { creationRequestId: requestId } })
      if (completed) return completed

      const link = selectedProjectId
        ? await this.resolveProjectLink(selectedProjectId)
        : await this.createOrRecoverSmartProject(runner, dto, title, requestId, responsibleId)
      await this.acquireLock(runner, bitrixProjectLockName(link.bitrixProjectId), locks)
      await runner.startTransaction('READ COMMITTED')
      const linkedProject = await repository.findOne({ where: { bitrixProjectId: link.bitrixProjectId } })
      if (linkedProject && selectedProjectId) {
        throw new ConflictException('Этот проект Битрикс24 уже связан с проектом Work Tracker')
      }
      // A catalogue sync can discover the card between the CRM write and our save.
      // Reuse that local ID and retain any fields not supplied by this request.
      const project = linkedProject ?? repository.create()
      Object.assign(project, dto, {
        title: link.title,
        bitrixProjectId: link.bitrixProjectId,
        clientCompanyId: link.clientCompanyId,
        clientCompany: link.clientCompany,
        creationRequestId: requestId,
      })
      const saved = await repository.save(project)
      await runner.commitTransaction()
      return saved
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      try {
        for (const name of locks.reverse()) {
          await runner.query('SELECT RELEASE_LOCK(?) AS released', [name])
        }
      } finally {
        await runner.release()
      }
    }
  }

  private async createOrRecoverSmartProject(
    runner: QueryRunner,
    dto: CreateReportProjectDto,
    title: string,
    requestId: string,
    responsibleId: string | null,
  ): Promise<ProjectCompanyLink> {
    if (typeof dto.projectGoal !== 'string' || !dto.projectGoal.trim()) {
      throw new BadRequestException('Укажите цель проекта')
    }
    const company = await this.resolveCompany(dto.clientCompanyId)
    const attempts: CreationAttempt[] = await runner.query(
      'SELECT project_title, company_id FROM project_report_creation_requests WHERE request_id = ?',
      [requestId],
    )
    const previousAttempt = attempts[0]
    if (previousAttempt && (previousAttempt.project_title !== title || previousAttempt.company_id !== company.clientCompanyId)) {
      throw new ConflictException('Предыдущая попытка создания относится к другому проекту или компании')
    }
    const xmlId = `work-tracker:${requestId}`
    const recovered = await this.bitrixService.listAllItems<BitrixProject>({
      entityTypeId: EntityTypeIds.projects,
      filter: { '=xmlId': xmlId },
      select: ['id', 'title', 'xmlId', ProjectCodes.company],
    })
    if (recovered.length > 1) {
      throw new BadGatewayException('В Битрикс24 найдено несколько проектов для одной попытки создания')
    }
    if (recovered.length === 1) {
      if (recovered[0].xmlId !== xmlId) {
        throw new BadGatewayException('Не удалось проверить созданный проект в Битрикс24')
      }
      const link = await this.readProject(recovered[0])
      if (link.clientCompanyId !== company.clientCompanyId || link.title !== title) {
        throw new ConflictException('Созданная карточка изменена в Битрикс24. Выберите её из списка проектов')
      }
      return link
    }
    if (previousAttempt) {
      // A timeout does not mean the remote write failed. Never issue another add.
      throw new ConflictException('Создание проекта ещё проверяется. Повторите сохранение позже или выберите существующую карточку')
    }
    // Autocommit this journal BEFORE calling CRM so a timeout/process restart
    // cannot turn a retry into a second remote create.
    await runner.query(
      'INSERT INTO project_report_creation_requests (request_id, project_title, company_id) VALUES (?, ?, ?)',
      [requestId, title, company.clientCompanyId],
    )
    const financialType = dto.projectType === ReportProjectType.Support ? FinancialProjectType.Support
      : dto.projectType === ReportProjectType.Waterfall ? FinancialProjectType.Waterfall : null
    let item: BitrixProject
    try {
      item = await this.bitrixService.addItem<BitrixProject>({
        entityTypeId: EntityTypeIds.projects,
        fields: {
          title, xmlId,
          [ProjectCodes.goal]: dto.projectGoal.trim(),
          [ProjectCodes.company]: Number(company.clientCompanyId),
          ...(financialType ? { [ProjectCodes.financialProjectType]: financialType } : {}),
          ...(responsibleId ? { [ProjectCodes.assignedBy]: Number(responsibleId) } : {}),
        },
      })
    } catch (error) {
      if (error instanceof BitrixItemCreateRejectedException) {
        await runner.query('DELETE FROM project_report_creation_requests WHERE request_id = ?', [requestId])
      }
      throw error
    }
    const link = await this.readProject(item)
    if (link.clientCompanyId !== company.clientCompanyId) {
      throw new BadGatewayException('Битрикс24 не сохранил компанию нового проекта. Выберите созданную карточку после проверки')
    }
    return link
  }

  private async readProject(item: BitrixProject): Promise<ProjectCompanyLink> {
    if (!item || typeof item !== 'object') {
      throw new BadGatewayException('Битрикс24 вернул некорректный проект')
    }
    const bitrixProjectId = this.positiveId(item.id, 'проекта Битрикс24')
    const title = this.projectTitle(item.title)
    if (item[ProjectCodes.company] == null || item[ProjectCodes.company] === '') {
      throw new BadRequestException('У выбранного проекта Битрикс24 не указана компания. Добавьте её в карточку проекта')
    }
    return { bitrixProjectId, title, ...await this.resolveCompany(item[ProjectCodes.company]) }
  }

  private projectTitle(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) {
      throw new BadRequestException('Укажите название проекта длиной до 255 символов')
    }
    return value.trim()
  }

  private async acquireLock(runner: QueryRunner, name: string, locks: string[]): Promise<void> {
    const result: Array<{ acquired: unknown }> = await runner.query('SELECT GET_LOCK(?, 5) AS acquired', [name])
    if (Number(result[0]?.acquired) !== 1) {
      throw new ConflictException('Проект уже сохраняется. Повторите сохранение через несколько секунд')
    }
    locks.push(name)
  }
}
