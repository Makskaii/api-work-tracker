import {
  ForbiddenException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { genSalt, hash } from 'bcryptjs'
import {
  ClientsCodes,
  DailyReportCodes,
  EntityTypeIds,
  ProjectCodes,
  TASK_SELECT_FIELDS,
  TaskCodes,
} from 'src/constants/const'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { UserInfo } from 'src/types/bitrix'
import { ReportProps } from 'src/types/reports'
import { TaskProps } from 'src/types/tasks'
import { FindOptionsWhere, Like, Repository } from 'typeorm'
import { ClientJwtPayload } from '../auth/client-jwt.guard'
import { toClientResponseDto } from './clients.mapper'
import {
  ClientCompanyDto,
  ClientProjectDto,
  ClientStatsDto,
  ClientTeamDto,
  ClientTeamRoleCode,
  toClientTeamUserDto,
} from './dto/client-bitrix-response.dto'
import { ClientResponseDto } from './dto/client-response.dto'
import { CreateClientDto } from './dto/create-client.dto'
import { GetClientStatsQueryDto } from './dto/get-client-stats-query.dto'
import { GetClientTasksQueryDto } from './dto/get-client-tasks-query.dto'
import { GetClientsQueryDto } from './dto/get-clients-query.dto'
import { Client, ClientStatus } from './entities/client.entity'

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
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

  async getMyCompany(
    authClient: ClientJwtPayload,
  ): Promise<ClientCompanyDto> {
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
  ): Promise<TaskProps[]> {
    const client = await this.getActiveAuthorizedClient(authClient)

    return this.bitrixService.listAllItems<TaskProps>({
      entityTypeId: EntityTypeIds.tasks,
      filter: this.buildClientTasksFilter(client.crmClientId, query),
      select: TASK_SELECT_FIELDS,
    })
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

  private async getBitrixCompany(
    crmClientId: number,
  ): Promise<ClientCompanyDto | null> {
    try {
      return await this.bitrixService.getItem<ClientCompanyDto>({
        entityTypeId: EntityTypeIds.companies,
        id: crmClientId,
      })
    } catch {
      const company = await this.bitrixService.getCompany<BitrixCompany>(
        crmClientId,
      )

      return company ? this.toClientCompanyDto(company) : null
    }
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
    const { createdFrom = '2026-04-01', start, end } = query

    if (start || end) {
      return {
        [TaskCodes.client]: crmClientId,
        ...(start ? { [`>=${TaskCodes.sprintDateStart}`]: start } : {}),
        ...(end ? { [`<=${TaskCodes.sprintDateStart}`]: end } : {}),
      }
    }

    return {
      [TaskCodes.company]: crmClientId,
      '>=createdTime': createdFrom,
    }
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

type BitrixCompany = {
  ID?: string | number
  TITLE?: string
  id?: string | number
  title?: string
  [key: string]: unknown
}

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
