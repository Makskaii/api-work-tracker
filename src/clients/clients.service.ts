import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { genSalt, hash } from 'bcryptjs'
import {
  CLIENT_TASK_APPROVAL_STAGE_IDS,
  CLIENT_TASK_BACKLOG_STAGE_IDS,
  CLIENT_TASK_DONE_STAGE_IDS,
  CLIENT_TASK_IN_WORK_STAGE_IDS,
  CLIENT_TASK_NEW_PROPOSAL_STAGE_IDS,
  CLIENT_TASK_PROPOSAL_CATEGORY_ID,
  CLIENT_TASK_PROPOSAL_STAGE_ID,
  CLIENT_TASK_SELECT_FIELDS,
  ClientsCodes,
  ClientTaskStatuses,
  DailyReportCodes,
  EntityTypeIds,
  ProjectCodes,
  TASK_SELECT_FIELDS,
  TaskCodes,
  TaskStageIds,
} from 'src/constants/const'
import {
  BitrixService,
  BitrixTimelineFile,
} from 'src/shared/integrations/bitrix/bitrix.service'
import { UserInfo } from 'src/types/bitrix'
import { ReportProps } from 'src/types/reports'
import { TaskProps } from 'src/types/tasks'
import { DataSource, FindOptionsWhere, Like, Repository } from 'typeorm'
import { ClientJwtPayload } from '../auth/client-jwt.guard'
import {
  toClientPurchasedHoursEventResponseDto,
  toClientResponseDto,
} from './clients.mapper'
import { ApproveClientTaskResponseDto } from './dto/approve-client-task-response.dto'
import { ChangeClientPurchasedHoursDto } from './dto/change-client-purchased-hours.dto'
import {
  ClientCompanyDto,
  ClientProjectDto,
  ClientStatsDto,
  ClientTeamDto,
  ClientTeamRoleCode,
  toClientTeamUserDto,
} from './dto/client-bitrix-response.dto'
import { ClientPurchasedHoursEventResponseDto } from './dto/client-purchased-hours-event-response.dto'
import { ClientResponseDto } from './dto/client-response.dto'
import { ClientTaskResponseDto } from './dto/client-task-response.dto'
import { CreateClientDto } from './dto/create-client.dto'
import {
  ClientTaskProposalFile,
  ClientTaskProposalResponseDto,
  CreateClientTaskProposalDto,
} from './dto/create-client-task-proposal.dto'
import { GetClientStatsQueryDto } from './dto/get-client-stats-query.dto'
import {
  ClientTasksStatusFilter,
  GetClientTasksQueryDto,
} from './dto/get-client-tasks-query.dto'
import { GetClientsQueryDto } from './dto/get-clients-query.dto'
import { UpdateClientDto } from './dto/update-client.dto'
import { Client, ClientStatus } from './entities/client.entity'
import {
  ClientPurchasedHoursEvent,
  ClientPurchasedHoursEventType,
} from './entities/client-purchased-hours-event.entity'


@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    @InjectRepository(ClientPurchasedHoursEvent)
    private readonly purchasedHoursEventsRepository: Repository<ClientPurchasedHoursEvent>,
    private readonly dataSource: DataSource,
    private readonly bitrixService: BitrixService,
  ) {}

  async create(createClientDto: CreateClientDto): Promise<ClientResponseDto> {
    const existingClientByCrmId = await this.clientsRepository.findOne({
      where: { crmClientId: createClientDto.crmId },
    })

    if (existingClientByCrmId) {
      throw new ConflictException('Client with this crmClientId already exists')
    }

    const existingClientByEmail = await this.clientsRepository.findOne({
      where: { email: createClientDto.email },
    })

    if (existingClientByEmail) {
      throw new ConflictException('Client with this email already exists')
    }

    const salt = await genSalt(10)
    const passwordHash = await hash(createClientDto.password, salt)

    const client = this.clientsRepository.create({
      name: createClientDto.name,
      email: createClientDto.email,
      crmClientId: createClientDto.crmId,
      passwordHash,
      status: ClientStatus.Active,
    })

    const savedClient = await this.clientsRepository.save(client)

    return toClientResponseDto(savedClient)
  }

  async findAll(query: GetClientsQueryDto): Promise<ClientResponseDto[]> {
    const where = this.buildFindAllWhere(query)

    const clients = await this.clientsRepository.find({
      where,
      order: {
        id: 'DESC',
      },
    })

    return clients.map(toClientResponseDto)
  }

  async update(
    id: number,
    updateClientDto: UpdateClientDto,
  ): Promise<ClientResponseDto> {
    const client = await this.clientsRepository.findOne({
      where: { id },
    })

    if (!client) {
      throw new NotFoundException('Client not found')
    }

    if (!this.hasClientUpdateFields(updateClientDto)) {
      throw new BadRequestException('No client update fields provided')
    }

    if (updateClientDto.email !== undefined) {
      await this.ensureEmailIsAvailable(updateClientDto.email, id)
      client.email = updateClientDto.email
    }

    if (updateClientDto.crmId !== undefined) {
      await this.ensureCrmClientIdIsAvailable(updateClientDto.crmId, id)
      client.crmClientId = updateClientDto.crmId
    }

    if (updateClientDto.name !== undefined) {
      client.name = updateClientDto.name
    }

    if (updateClientDto.status !== undefined) {
      client.status = updateClientDto.status
    }

    if (Object.hasOwn(updateClientDto, 'purchasedHours')) {
      const purchasedHours = updateClientDto.purchasedHours

      client.purchasedHours =
        purchasedHours === null || purchasedHours === undefined
          ? null
          : this.roundTime(purchasedHours)
    }

    const savedClient = await this.clientsRepository.save(client)

    return toClientResponseDto(savedClient)
  }

  deactivate(id: number): Promise<ClientResponseDto> {
    return this.updateStatus(id, ClientStatus.Inactive)
  }

  activate(id: number): Promise<ClientResponseDto> {
    return this.updateStatus(id, ClientStatus.Active)
  }

  async toggleStatus(id: number): Promise<ClientResponseDto> {
    const client = await this.clientsRepository.findOne({
      where: { id },
    })

    if (!client) {
      throw new NotFoundException('Client not found')
    }

    client.status =
      client.status === ClientStatus.Active
        ? ClientStatus.Inactive
        : ClientStatus.Active

    const savedClient = await this.clientsRepository.save(client)

    return toClientResponseDto(savedClient)
  }

  async remove(id: number): Promise<void> {
    const result = await this.clientsRepository.delete(id)

    if (!result.affected) {
      throw new NotFoundException('Client not found')
    }
  }

  addPurchasedHours(
    id: number,
    dto: ChangeClientPurchasedHoursDto,
  ): Promise<ClientResponseDto> {
    return this.changePurchasedHours(
      id,
      dto,
      ClientPurchasedHoursEventType.Added,
    )
  }

  removePurchasedHours(
    id: number,
    dto: ChangeClientPurchasedHoursDto,
  ): Promise<ClientResponseDto> {
    return this.changePurchasedHours(
      id,
      dto,
      ClientPurchasedHoursEventType.Removed,
    )
  }

  async getPurchasedHoursEvents(
    id: number,
  ): Promise<ClientPurchasedHoursEventResponseDto[]> {
    const client = await this.clientsRepository.findOne({
      where: { id },
      select: {
        id: true,
      },
    })

    if (!client) {
      throw new NotFoundException('Client not found')
    }

    const events = await this.purchasedHoursEventsRepository.find({
      where: { clientId: id },
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
    })

    return events.map(toClientPurchasedHoursEventResponseDto)
  }

  async getMyCompany(authClient: ClientJwtPayload): Promise<ClientCompanyDto> {
    const client = await this.getActiveAuthorizedClient(authClient)
    const crmClientId = Number(client.crmClientId)

    const company = await this.getBitrixCompany(crmClientId)

    if (!company) {
      throw new NotFoundException('Bitrix company not found')
    }

    return company
  }

  async getMyProjects(
    authClient: ClientJwtPayload,
  ): Promise<ClientProjectDto[]> {
    const client = await this.getActiveAuthorizedClient(authClient)

    const projects = await this.getClientProjects(client.crmClientId)

    return projects.map((project) => this.toClientProjectDto(project))
  }

  async getMyTasks(
    authClient: ClientJwtPayload,
    query: GetClientTasksQueryDto = {},
  ): Promise<ClientTaskResponseDto[]> {
    const client = await this.getActiveAuthorizedClient(authClient)

    const tasks = await this.bitrixService.listAllItems<ClientTaskBitrixItem>({
      entityTypeId: EntityTypeIds.tasks,
      filter: this.buildClientTasksFilter(client.crmClientId, query),
      select: CLIENT_TASK_SELECT_FIELDS,
    })

    return tasks.map((task) => this.toClientTaskResponseDto(task))
  }

  async createMyTaskProposal(
    authClient: ClientJwtPayload,
    dto: CreateClientTaskProposalDto,
    files: ClientTaskProposalFile[] = [],
  ): Promise<ClientTaskProposalResponseDto> {
    const client = await this.getActiveAuthorizedClient(authClient)
    const assignedById = await this.getClientPmId(client.crmClientId)

    const task = await this.bitrixService.addItem<ClientTaskProposalBitrixItem>(
      {
        entityTypeId: EntityTypeIds.tasks,
        fields: {
          title: dto.title,
          stageId: CLIENT_TASK_PROPOSAL_STAGE_ID,
          categoryId: CLIENT_TASK_PROPOSAL_CATEGORY_ID,
          assignedById,
          [TaskCodes.description]: dto.description,
          [TaskCodes.client]: client.crmClientId,
          [TaskCodes.company]: client.crmClientId,
          [TaskCodes.parentproject]: dto.project,
        },
      },
    )

    const timelineCommentId = await this.attachFilesToTaskTimelineComment({
      taskId: Number(task.id),
      comment: dto.description,
      files,
    })

    return {
      id: Number(task.id),
      title: task.title,
      description: task[TaskCodes.description] ?? dto.description,
      assignedById: Number(task.assignedById),
      stageId: task.stageId,
      timelineCommentId,
      attachedFilesCount: files.length,
    }
  }

  async approveMyTask(
    authClient: ClientJwtPayload,
    taskId: number,
  ): Promise<ApproveClientTaskResponseDto> {
    const client = await this.getActiveAuthorizedClient(authClient)
    const task = await this.bitrixService.getItem<ClientTaskApprovalBitrixItem>(
      {
        entityTypeId: EntityTypeIds.tasks,
        id: taskId,
      },
    )

    if (!task) {
      throw new NotFoundException('Bitrix task not found')
    }

    if (Number(task[TaskCodes.client]) !== Number(client.crmClientId)) {
      throw new ForbiddenException('Task does not belong to current client')
    }

    if (task.stageId !== TaskStageIds.approval) {
      throw new BadRequestException('Task is not waiting for client approval')
    }

    const updatedTask =
      await this.bitrixService.updateItem<ClientTaskApprovalBitrixItem>({
        entityTypeId: EntityTypeIds.tasks,
        id: taskId,
        fields: {
          stageId: TaskStageIds.backlog,
        },
      })

    return {
      id: Number(updatedTask.id),
      stageId: updatedTask.stageId,
      status: this.getClientTaskStatus(updatedTask.stageId),
    }
  }

  async getMyStats(
    authClient: ClientJwtPayload,
    query: GetClientStatsQueryDto,
  ): Promise<ClientStatsDto> {
    const client = await this.getActiveAuthorizedClient(authClient)
    const { start, end } = query

    const [tasks, internalReports, externalReports] = await Promise.all([
      this.bitrixService.listAllItems<TaskProps>({
        entityTypeId: EntityTypeIds.tasks,
        filter: this.buildClientTasksFilter(client.crmClientId, {
          start,
          end,
        }),
        select: TASK_SELECT_FIELDS,
      }),
      this.getCommunicationReports(client.crmClientId, start, end, '402'),
      this.getCommunicationReports(client.crmClientId, start, end, '417'),
    ])



    const internalTotal = this.sumReportTime(internalReports)
    const externalTotal = this.sumReportTime(externalReports)

    return {
      purchasedHours: this.toNullableNumber(client.purchasedHours),
      period: {
        start,
        end,
      },
      tasks: {
        count: tasks.length,
        totalTime: this.sumTaskTime(tasks),
      },
      communications: {
        totalTime: this.roundTime(internalTotal + externalTotal),
        internal: {
          activityType: '402',
          count: internalReports.length,
          totalTime: internalTotal,
        },
        external: {
          activityType: '417',
          count: externalReports.length,
          totalTime: externalTotal,
        },
      },
    }
  }

  async getMyTeam(authClient: ClientJwtPayload): Promise<ClientTeamDto> {
    const client = await this.getActiveAuthorizedClient(authClient)

    const projects = await this.bitrixService.listAllItems<ClientProjectTeam>({
      entityTypeId: EntityTypeIds.projects,
      filter: {
        [ClientsCodes.client]: client.crmClientId,
      },
      select: [
        'id',
        'title',
        'assignedById',
        ProjectCodes.analytic,
        ProjectCodes.devs,
        ProjectCodes.qa,
      ],
    })

    const preparedRoles = this.prepareTeamRoles(projects)
    const userIds = Array.from(
      new Set(preparedRoles.flatMap((role) => role.userIds)),
    )
    const users = await this.bitrixService.getUsersByIds(userIds)
    const usersMap = new Map(users.map((user) => [Number(user.id), user]))

    return {
      roles: preparedRoles.map((role) => ({
        ...role,
        users: role.userIds
          .map((userId) => usersMap.get(userId))
          .filter((user): user is UserInfo => Boolean(user))
          .map((user) => toClientTeamUserDto(user)),
      })),
    }
  }

  private async updateStatus(
    id: number,
    status: ClientStatus,
  ): Promise<ClientResponseDto> {
    const client = await this.clientsRepository.findOne({
      where: { id },
    })

    if (!client) {
      throw new NotFoundException('Client not found')
    }

    client.status = status

    const savedClient = await this.clientsRepository.save(client)

    return toClientResponseDto(savedClient)
  }

  private changePurchasedHours(
    id: number,
    dto: ChangeClientPurchasedHoursDto,
    type: ClientPurchasedHoursEventType,
  ): Promise<ClientResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const clientsRepository = manager.getRepository(Client)
      const purchasedHoursEventsRepository = manager.getRepository(
        ClientPurchasedHoursEvent,
      )
      const client = await clientsRepository.findOne({
        where: { id },
        lock: {
          mode: 'pessimistic_write',
        },
      })

      if (!client) {
        throw new NotFoundException('Client not found')
      }

      const currentHours = this.toNumber(client.purchasedHours)
      const changedHours = this.roundTime(dto.hours)

      if (
        type === ClientPurchasedHoursEventType.Removed &&
        client.purchasedHours === null
      ) {
        throw new BadRequestException('Client has no purchased hours')
      }

      if (
        type === ClientPurchasedHoursEventType.Removed &&
        currentHours < changedHours
      ) {
        throw new BadRequestException('Not enough purchased hours')
      }

      const nextHours =
        type === ClientPurchasedHoursEventType.Added
          ? currentHours + changedHours
          : currentHours - changedHours
      const balanceAfter = this.roundTime(nextHours)

      client.purchasedHours = balanceAfter

      const savedClient = await clientsRepository.save(client)
      const comment = dto.comment?.trim() || null

      const event = purchasedHoursEventsRepository.create({
        clientId: id,
        type,
        hours: changedHours,
        balanceAfter,
        comment,
      })

      await purchasedHoursEventsRepository.save(event)

      return toClientResponseDto(savedClient)
    })
  }

  private async getActiveAuthorizedClient(
    authClient: ClientJwtPayload,
  ): Promise<Client> {
    const clientId = Number(authClient.sub)

    if (!Number.isFinite(clientId)) {
      throw new UnauthorizedException('Invalid client token')
    }

    const client = await this.clientsRepository.findOne({
      where: { id: clientId },
    })

    if (!client) {
      throw new UnauthorizedException('Client not found')
    }

    if (client.status !== ClientStatus.Active) {
      throw new ForbiddenException('Client is inactive')
    }

    if (Number(client.crmClientId) !== Number(authClient.crmClientId)) {
      throw new UnauthorizedException('Invalid client token')
    }

    return client
  }

  private getClientProjects(crmClientId: number): Promise<ClientProject[]> {
    return this.bitrixService.listAllItems<ClientProject>({
      entityTypeId: EntityTypeIds.projects,
      filter: {
        [ClientsCodes.client]: crmClientId,
      },
      select: ['id', 'title', ClientsCodes.client],
    })
  }

  private async getClientPmId(crmClientId: number): Promise<number> {
    const projects = await this.bitrixService.listAllItems<ClientProjectTeam>({
      entityTypeId: EntityTypeIds.projects,
      filter: {
        [ClientsCodes.client]: crmClientId,
      },
      select: ['id', 'title', 'assignedById', ProjectCodes.pm],
    })

    const pmIds = Array.from(
      new Set(
        projects.flatMap((project) =>
          this.normalizeUserIds(
            this.getProjectRoleValue(project, ProjectCodes.pm),
          ),
        ),
      ),
    )

    const pmId = pmIds[0]

    if (!pmId) {
      throw new NotFoundException('Client PM not found')
    }

    return pmId
  }

  private async getBitrixCompany(
    crmClientId: number,
  ): Promise<ClientCompanyDto | null> {
    try {
      return await this.bitrixService.getItem<ClientCompanyDto>({
        entityTypeId: EntityTypeIds.companies,
        id: crmClientId,
      })
    } catch {
      const company =
        await this.bitrixService.getCompany<BitrixCompany>(crmClientId)

      return company ? this.toClientCompanyDto(company) : null
    }
  }

  private async attachFilesToTaskTimelineComment({
    taskId,
    comment,
    files,
  }: {
    taskId: number
    comment: string
    files: ClientTaskProposalFile[]
  }): Promise<number | null> {
    if (!files.length) {
      return null
    }

    if (!Number.isFinite(taskId) || taskId <= 0) {
      throw new BadRequestException('Invalid created task id')
    }

    const timelineCommentId = await this.bitrixService.addTimelineComment({
      entityId: taskId,
      entityType: `DYNAMIC_${EntityTypeIds.tasks}`,
      comment,
    })

    await this.bitrixService.updateTimelineComment({
      id: timelineCommentId,
      ownerTypeId: EntityTypeIds.tasks,
      ownerId: taskId,
      comment,
      files: this.toBitrixTimelineFiles(files),
    })

    return timelineCommentId
  }

  private toBitrixTimelineFiles(
    files: ClientTaskProposalFile[],
  ): BitrixTimelineFile[] {
    return files.map((file) => [
      file.originalname,
      file.buffer.toString('base64'),
    ])
  }

  private getCommunicationReports(
    crmClientId: number,
    start: string,
    end: string,
    activityType: string,
  ): Promise<ReportProps[]> {
    return this.bitrixService.listAllItems<ReportProps>({
      entityTypeId: EntityTypeIds.reports,
      filter: {
        [DailyReportCodes.client]: crmClientId,
        [DailyReportCodes.activityType]: activityType,
        '>=begindate': start,
        '<=begindate': end,
      },
      select: CLIENT_REPORT_SELECT,
    })
  }

  private buildClientTasksFilter(
    crmClientId: number,
    query: GetClientTasksQueryDto,
  ) {
    const { createdFrom = '2026-04-01', start, end, status } = query

    if (start || end) {
      return {
        [TaskCodes.company]: crmClientId,
        ...(start ? { [`>=createdTime`]: start } : {}),
        ...(end ? { [`<=createdTime`]: end } : {}),
        ...this.buildClientTasksStatusFilter(status),
        stageId: TaskStageIds.done
      }
    }

    return {
      [TaskCodes.company]: crmClientId,
      '>=createdTime': createdFrom,
      ...this.buildClientTasksStatusFilter(status),
    }
  }

  private buildClientTasksStatusFilter(
    status?: ClientTasksStatusFilter,
  ): Record<string, readonly string[]> {
    const stageIds = this.getClientTaskStatusStageIds(status)

    return stageIds.length ? { '@stageId': stageIds } : {}
  }

  private getClientTaskStatusStageIds(
    status?: ClientTasksStatusFilter,
  ): readonly string[] {
    switch (status) {
      case ClientTasksStatusFilter.InWork:
        return CLIENT_TASK_IN_WORK_STAGE_IDS
      case ClientTasksStatusFilter.Done:
        return CLIENT_TASK_DONE_STAGE_IDS
      case ClientTasksStatusFilter.NewProposal:
        return CLIENT_TASK_NEW_PROPOSAL_STAGE_IDS
      case ClientTasksStatusFilter.Approval:
        return CLIENT_TASK_APPROVAL_STAGE_IDS
      case ClientTasksStatusFilter.All:
      default:
        return []
    }
  }

  private toClientTaskResponseDto(
    task: ClientTaskBitrixItem,
  ): ClientTaskResponseDto {
    return {
      id: String(task.id),
      title: task.title,
      status: this.getClientTaskStatus(task.stageId),
      [TaskCodes.result]: task[TaskCodes.result] ?? null,
      [TaskCodes.hours]: task[TaskCodes.hours] ?? null,
      [TaskCodes.client]: task[TaskCodes.client] ?? null,
      [TaskCodes.parentproject]: task[TaskCodes.parentproject] ?? null,
      [TaskCodes.description]: task[TaskCodes.description] ?? null,
      [TaskCodes.comment]: task[TaskCodes.comment] ?? null,
    }
  }

  private getClientTaskStatus(stageId?: string) {
    if (this.isStageInGroup(stageId, CLIENT_TASK_DONE_STAGE_IDS)) {
      return ClientTaskStatuses.done
    }

    if (this.isStageInGroup(stageId, CLIENT_TASK_APPROVAL_STAGE_IDS)) {
      return ClientTaskStatuses.approval
    }

    if (this.isStageInGroup(stageId, CLIENT_TASK_NEW_PROPOSAL_STAGE_IDS)) {
      return ClientTaskStatuses.newProposal
    }

    if (this.isStageInGroup(stageId, CLIENT_TASK_IN_WORK_STAGE_IDS)) {
      return ClientTaskStatuses.inWork
    }

    if (this.isStageInGroup(stageId, CLIENT_TASK_BACKLOG_STAGE_IDS)) {
      return ClientTaskStatuses.backlog
    }

    return ClientTaskStatuses.inWork
  }

  private isStageInGroup(
    stageId: string | undefined,
    group: readonly string[],
  ): boolean {
    return Boolean(stageId && group.includes(stageId))
  }

  private sumTaskTime(tasks: TaskProps[]): number {
    return this.roundTime(
      tasks.reduce((acc, task) => {
        return acc + this.toNumber(task[TaskCodes.hours])
      }, 0),
    )
  }

  private sumReportTime(reports: ReportProps[]): number {
    return this.roundTime(
      reports.reduce((acc, report) => {
        return acc + this.toNumber(report[DailyReportCodes.timeSpent])
      }, 0),
    )
  }

  private toClientProjectDto(project: ClientProject): ClientProjectDto {
    const id = Number(project.id)

    return {
      ...project,
      id,
      title: project.title,
      clientId: this.toNullableNumber(project[ClientsCodes.client]),
      projectId: String(project.projectId ?? id),
    }
  }

  private toClientCompanyDto(company: BitrixCompany): ClientCompanyDto {
    const id = Number(company.ID ?? company.id)
    const title = company.TITLE ?? company.title

    return {
      ...company,
      id,
      title,
    }
  }

  private prepareTeamRoles(projects: ClientProjectTeam[]) {
    return CLIENT_TEAM_ROLES.map(({ roleCode, roleTitle, fieldCode }) => {
      const userIds = projects.flatMap((project) =>
        this.normalizeUserIds(this.getProjectRoleValue(project, fieldCode)),
      )

      return {
        roleCode,
        roleTitle,
        fieldCode,
        userIds: Array.from(new Set(userIds)),
      }
    })
  }

  private getProjectRoleValue(
    project: ClientProjectTeam,
    fieldCode: ProjectCodes,
  ) {
    if (fieldCode === ProjectCodes.pm) {
      return project.assignedById ?? project[ProjectCodes.pm]
    }

    return project[fieldCode]
  }

  private normalizeUserIds(value: ClientTeamRawValue): number[] {
    if (value === null || value === undefined) {
      return []
    }

    if (Array.isArray(value)) {
      return value
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    }

    const id = Number(value)

    return Number.isFinite(id) && id > 0 ? [id] : []
  }

  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  private toNumber(value: unknown): number {
    const parsed = Number(String(value ?? '0').replace(',', '.'))

    return Number.isFinite(parsed) ? parsed : 0
  }

  private roundTime(value: number): number {
    return Number(value.toFixed(2))
  }

  private buildFindAllWhere(
    query: GetClientsQueryDto,
  ): FindOptionsWhere<Client> | FindOptionsWhere<Client>[] {
    const { status, search } = query

    if (!search) {
      return status ? { status } : {}
    }

    const searchLike = Like(`%${search}%`)

    return [
      {
        ...(status ? { status } : {}),
        name: searchLike,
      },
      {
        ...(status ? { status } : {}),
        email: searchLike,
      },
    ]
  }

  private hasClientUpdateFields(updateClientDto: UpdateClientDto): boolean {
    return CLIENT_UPDATE_FIELDS.some((field) =>
      Object.hasOwn(updateClientDto, field),
    )
  }

  private async ensureEmailIsAvailable(
    email: string,
    clientId: number,
  ): Promise<void> {
    const existingClient = await this.clientsRepository.findOne({
      where: { email },
      select: {
        id: true,
      },
    })

    if (existingClient && Number(existingClient.id) !== clientId) {
      throw new ConflictException('Client with this email already exists')
    }
  }

  private async ensureCrmClientIdIsAvailable(
    crmClientId: number,
    clientId: number,
  ): Promise<void> {
    const existingClient = await this.clientsRepository.findOne({
      where: { crmClientId },
      select: {
        id: true,
      },
    })

    if (existingClient && Number(existingClient.id) !== clientId) {
      throw new ConflictException('Client with this crmClientId already exists')
    }
  }
}

type ClientTeamRawValue = number | string | number[] | string[] | null

type ClientProject = {
  id: number | string
  title: string
  projectId?: string
  [ClientsCodes.client]?: number | string
}

type ClientProjectTeam = {
  id: number | string
  title: string
  assignedById?: number | string | null
  [ProjectCodes.pm]?: ClientTeamRawValue
  [ProjectCodes.analytic]?: ClientTeamRawValue
  [ProjectCodes.devs]?: ClientTeamRawValue
  [ProjectCodes.qa]?: ClientTeamRawValue
}

type ClientTaskProposalBitrixItem = {
  id: number | string
  title: string
  assignedById: number | string
  stageId: string
  [TaskCodes.description]?: string | null
}

type ClientTaskBitrixItem = {
  id: number | string
  title: string
  stageId?: string
  [TaskCodes.result]?: string | null
  [TaskCodes.hours]?: string | number | null
  [TaskCodes.client]?: string | number | null
  [TaskCodes.parentproject]?: string | number | null
  [TaskCodes.description]?: string | null
  [TaskCodes.comment]?: string | null
}

type ClientTaskApprovalBitrixItem = {
  id: number | string
  stageId: string
  [TaskCodes.client]?: string | number | null
}

type BitrixCompany = {
  ID?: string | number
  TITLE?: string
  id?: string | number
  title?: string
  [key: string]: unknown
}

const CLIENT_UPDATE_FIELDS = [
  'name',
  'email',
  'crmId',
  'status',
  'purchasedHours',
] satisfies readonly (keyof UpdateClientDto)[]

const CLIENT_TEAM_ROLES: {
  roleCode: ClientTeamRoleCode
  roleTitle: string
  fieldCode: ProjectCodes
}[] = [
  {
    roleCode: 'pm',
    roleTitle: 'PM',
    fieldCode: ProjectCodes.pm,
  },
  {
    roleCode: 'analytic',
    roleTitle: 'Аналитик',
    fieldCode: ProjectCodes.analytic,
  },
  {
    roleCode: 'devs',
    roleTitle: 'Разработчики',
    fieldCode: ProjectCodes.devs,
  },
  {
    roleCode: 'qa',
    roleTitle: 'QA',
    fieldCode: ProjectCodes.qa,
  },
]

const CLIENT_REPORT_SELECT = [
  'id',
  'title',
  'begindate',
  DailyReportCodes.title,
  DailyReportCodes.timeSpent,
  DailyReportCodes.project,
  DailyReportCodes.taskId,
  DailyReportCodes.activityType,
  'assignedById',
  'createdTime',
  'lastActivityTime',
  `parentId${EntityTypeIds.tasks}`,
] as const
