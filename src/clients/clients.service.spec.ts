import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Test, TestingModule } from '@nestjs/testing'
import {
  CLIENT_TASK_APPROVAL_STAGE_IDS,
  CLIENT_TASK_IN_WORK_STAGE_IDS,
  CLIENT_TASK_NEW_PROPOSAL_STAGE_IDS,
  CLIENT_TASK_PROPOSAL_CATEGORY_ID,
  CLIENT_TASK_PROPOSAL_STAGE_ID,
  CLIENT_TASK_SELECT_FIELDS,
  ClientsCodes,
  DailyReportCodes,
  EntityTypeIds,
  TASK_SELECT_FIELDS,
  TaskStageIds,
  TaskCodes,
} from 'src/constants/const'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { DataSource } from 'typeorm'
import { ClientsService } from './clients.service'
import {
  ClientPurchasedHoursEvent,
  ClientPurchasedHoursEventType,
} from './entities/client-purchased-hours-event.entity'
import { Client, ClientStatus } from './entities/client.entity'
import { ClientTasksStatusFilter } from './dto/get-client-tasks-query.dto'

describe('ClientsService', () => {
  let service: ClientsService

  const client = {
    id: 1,
    crmClientId: 42,
    status: ClientStatus.Active,
  } as Client

  const clientsRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  }

  const purchasedHoursEventsRepository = {
    find: jest.fn(),
  }

  const transactionalClientsRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  }

  const transactionalPurchasedHoursEventsRepository = {
    create: jest.fn(),
    save: jest.fn(),
  }

  const dataSource = {
    transaction: jest.fn(),
  }

  const bitrixService = {
    addItem: jest.fn(),
    addTimelineComment: jest.fn(),
    getItem: jest.fn(),
    listAllItems: jest.fn(),
    getUsersByIds: jest.fn(),
    updateItem: jest.fn(),
    updateTimelineComment: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: getRepositoryToken(Client),
          useValue: clientsRepository,
        },
        {
          provide: getRepositoryToken(ClientPurchasedHoursEvent),
          useValue: purchasedHoursEventsRepository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: BitrixService,
          useValue: bitrixService,
        },
      ],
    }).compile()

    service = module.get<ClientsService>(ClientsService)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  it('reads the exact cabinet task list and completed metrics without changing public responses or stored hours', async () => {
    clientsRepository.findOne.mockResolvedValue({ ...client, purchasedHours: '65' })
    const completedTasks = [
      { id: 101, title: 'Первая выполненная', stageId: TaskStageIds.done, [TaskCodes.hours]: '29', [TaskCodes.parentproject]: 24 },
      { id: 102, title: 'Другая выполненная', stageId: TaskStageIds.done, [TaskCodes.hours]: '33', [TaskCodes.parentproject]: 99 },
    ]
    const tasks = [...completedTasks, ...Array.from({ length: 23 }, (_, index) => ({
      id: index + 103, title: `Без отчётов ${index}`, stageId: TaskStageIds.inWork,
      [TaskCodes.hours]: '5', [TaskCodes.parentproject]: index % 2 ? 24 : null,
    }))]
    const source = structuredClone(tasks)
    bitrixService.listAllItems.mockImplementation(({ entityTypeId, filter }: { entityTypeId: number; filter: Record<string, unknown> }) => {
      if (entityTypeId === EntityTypeIds.reports) return Promise.resolve([])
      return Promise.resolve(filter.stageId === TaskStageIds.done ? completedTasks : tasks)
    })
    const now = new Date('2026-10-08T21:30:00Z')
    const statsPeriod = { start: '2026-04-01', end: '2026-10-09T20:59:59.999Z' }
    const presentation = await service.getCompanyReportPresentation(42, now)
    expect(clientsRepository.findOne).toHaveBeenNthCalledWith(1, {
      where: { crmClientId: 42, status: ClientStatus.Active },
      select: { crmClientId: true, status: true, purchasedHours: true },
    })
    expect(bitrixService.listAllItems).toHaveBeenNthCalledWith(1, {
      entityTypeId: EntityTypeIds.tasks,
      filter: { [TaskCodes.company]: 42, '>=createdTime': '2026-04-01' },
      select: CLIENT_TASK_SELECT_FIELDS,
    })
    expect(bitrixService.listAllItems).toHaveBeenNthCalledWith(2, {
      entityTypeId: EntityTypeIds.tasks,
      filter: { [TaskCodes.company]: 42, '>=createdTime': statsPeriod.start, '<=createdTime': statsPeriod.end, stageId: TaskStageIds.done },
      select: TASK_SELECT_FIELDS,
    })
    const authClient = { sub: 1, email: 'client@example.com', crmClientId: 42, role: 'client' as const }
    const cabinetTasks = await service.getMyTasks(authClient)
    const cabinetStats = await service.getMyStats(authClient, statsPeriod)
    expect(presentation).toEqual({
      tasks: cabinetTasks, purchasedHours: cabinetStats.purchasedHours,
      completedHours: cabinetStats.tasks.totalTime, completedTaskCount: cabinetStats.tasks.count,
      completedTaskIds: ['101', '102'], statsPeriod,
    })
    expect(presentation.tasks).toHaveLength(25)
    expect(presentation).toMatchObject({ purchasedHours: 65, completedHours: 62, completedTaskCount: 2 })
    expect(cabinetStats).toEqual({
      purchasedHours: 65, period: statsPeriod, tasks: { count: 2, totalTime: 62 },
      communications: {
        totalTime: 0, internal: { activityType: '402', count: 0, totalTime: 0 },
        external: { activityType: '417', count: 0, totalTime: 0 },
      },
    })
    expect(tasks).toEqual(source)
    expect(clientsRepository.save).not.toHaveBeenCalled()
    expect(dataSource.transaction).not.toHaveBeenCalled()
    expect(bitrixService.addItem).not.toHaveBeenCalled()
    expect(bitrixService.updateItem).not.toHaveBeenCalled()
  })

  it.each([null, { ...client, status: ClientStatus.Inactive }])('rejects a company without an active cabinet client (%s)', async (foundClient) => {
    clientsRepository.findOne.mockResolvedValue(foundClient)
    await expect(service.getCompanyReportPresentation(42, new Date('2026-10-08T09:00:00Z'))).rejects.toThrow(NotFoundException)
    expect(bitrixService.listAllItems).not.toHaveBeenCalled()
  })

  it.each([[null, null], ['0', 0], ['2.25', 2.25]])('preserves purchased hours %s as %s without inventing a client budget', async (purchasedHours, expected) => {
    clientsRepository.findOne.mockResolvedValue({ ...client, purchasedHours })
    bitrixService.listAllItems.mockResolvedValue([])
    const result = await service.getCompanyReportPresentation(42, new Date('2026-10-08T09:00:00Z'))
    expect(result).toMatchObject({ tasks: [], purchasedHours: expected, completedHours: 0, completedTaskCount: 0, completedTaskIds: [] })
  })

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid report company %s before reading client data', async (companyId) => {
    await expect(service.getCompanyReportPresentation(companyId, new Date('2026-10-08T09:00:00Z'))).rejects.toThrow(BadRequestException)
    expect(clientsRepository.findOne).not.toHaveBeenCalled()
    expect(bitrixService.listAllItems).not.toHaveBeenCalled()
  })

  it('rejects an invalid report date before reading client data', async () => {
    await expect(service.getCompanyReportPresentation(42, new Date('invalid'))).rejects.toThrow(BadRequestException)
    expect(clientsRepository.findOne).not.toHaveBeenCalled()
    expect(bitrixService.listAllItems).not.toHaveBeenCalled()
  })

  it('loads current client tasks through server-side Bitrix integration', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([
      {
        id: 123,
        title: 'Task',
        stageId: 'DT1072_18:CLIENT',
        [TaskCodes.result]: 'Result',
        [TaskCodes.hours]: '2',
        [TaskCodes.client]: 42,
        [TaskCodes.parentproject]: 24,
        [TaskCodes.description]: 'Description',
        [TaskCodes.comment]: 'Comment',
      },
    ])

    const result = await service.getMyTasks({
      sub: 1,
      email: 'client@example.com',
      crmClientId: 42,
      role: 'client',
    })

    expect(bitrixService.listAllItems).toHaveBeenCalledWith(
      expect.objectContaining({
        entityTypeId: EntityTypeIds.tasks,
        filter: expect.objectContaining({
          [TaskCodes.company]: 42,
          '>=createdTime': '2026-04-01',
        }),
        select: CLIENT_TASK_SELECT_FIELDS,
      }),
    )
    expect(result).toEqual([
      {
        id: '123',
        title: 'Task',
        status: 'In work',
        [TaskCodes.result]: 'Result',
        [TaskCodes.hours]: '2',
        [TaskCodes.client]: 42,
        [TaskCodes.parentproject]: 24,
        [TaskCodes.description]: 'Description',
        [TaskCodes.comment]: 'Comment',
      },
    ])
  })

  it('keeps the existing completed-task creation-period filter when dates are provided', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([])

    await service.getMyTasks(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      {
        start: '2026-05-01',
        end: '2026-05-14',
      },
    )

    expect(bitrixService.listAllItems).toHaveBeenCalledWith(
      expect.objectContaining({
        entityTypeId: EntityTypeIds.tasks,
        filter: expect.objectContaining({
          [TaskCodes.company]: 42,
          '>=createdTime': '2026-05-01',
          '<=createdTime': '2026-05-14',
          stageId: TaskStageIds.done,
        }),
      }),
    )
  })

  it('filters current client tasks by in-work statuses', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([])

    await service.getMyTasks(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      {
        status: ClientTasksStatusFilter.InWork,
      },
    )

    expect(bitrixService.listAllItems).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          '@stageId': CLIENT_TASK_IN_WORK_STAGE_IDS,
        }),
      }),
    )
    expect(CLIENT_TASK_IN_WORK_STAGE_IDS).toContain(TaskStageIds.sprint)
  })

  it('filters current client tasks by new proposal statuses', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([])

    await service.getMyTasks(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      {
        status: ClientTasksStatusFilter.NewProposal,
      },
    )

    expect(bitrixService.listAllItems).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          '@stageId': CLIENT_TASK_NEW_PROPOSAL_STAGE_IDS,
        }),
      }),
    )
  })

  it('filters current client tasks by approval statuses', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([])

    await service.getMyTasks(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      {
        status: ClientTasksStatusFilter.Approval,
      },
    )

    expect(bitrixService.listAllItems).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: expect.objectContaining({
          '@stageId': CLIENT_TASK_APPROVAL_STAGE_IDS,
        }),
      }),
    )
  })

  it('creates current client task proposal in Bitrix and assigns client PM', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([
      {
        id: 10,
        title: 'Project',
        assignedById: 7,
        [ClientsCodes.client]: 42,
      },
    ])
    bitrixService.addItem.mockResolvedValue({
      id: 123,
      title: 'New task',
      assignedById: 7,
      stageId: CLIENT_TASK_PROPOSAL_STAGE_ID,
      [TaskCodes.description]: 'Task details',
    })

    const result = await service.createMyTaskProposal(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      {
        title: 'New task',
        description: 'Task details',
        project: 24,
      },
    )

    expect(bitrixService.listAllItems).toHaveBeenCalledWith({
      entityTypeId: EntityTypeIds.projects,
      filter: {
        [ClientsCodes.client]: 42,
      },
      select: ['id', 'title', 'assignedById', 'ASSIGNED_BY_ID'],
    })
    expect(bitrixService.addItem).toHaveBeenCalledWith({
      entityTypeId: EntityTypeIds.tasks,
      fields: expect.objectContaining({
        title: 'New task',
        stageId: CLIENT_TASK_PROPOSAL_STAGE_ID,
        categoryId: CLIENT_TASK_PROPOSAL_CATEGORY_ID,
        assignedById: 7,
        [TaskCodes.description]: 'Task details',
        [TaskCodes.client]: 42,
        [TaskCodes.company]: 42,
        [TaskCodes.parentproject]: 24,
      }),
    })
    expect(result).toMatchObject({
      id: 123,
      title: 'New task',
      description: 'Task details',
      assignedById: 7,
      stageId: CLIENT_TASK_PROPOSAL_STAGE_ID,
      timelineCommentId: null,
      attachedFilesCount: 0,
    })
    expect(bitrixService.addTimelineComment).not.toHaveBeenCalled()
    expect(bitrixService.updateTimelineComment).not.toHaveBeenCalled()
  })

  it('attaches uploaded files to current client task proposal timeline comment', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([
      {
        id: 10,
        title: 'Project',
        assignedById: 7,
        [ClientsCodes.client]: 42,
      },
    ])
    bitrixService.addItem.mockResolvedValue({
      id: 123,
      title: 'New task',
      assignedById: 7,
      stageId: CLIENT_TASK_PROPOSAL_STAGE_ID,
      [TaskCodes.description]: 'Task details',
    })
    bitrixService.addTimelineComment.mockResolvedValue(555)
    bitrixService.updateTimelineComment.mockResolvedValue(555)

    const result = await service.createMyTaskProposal(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      {
        title: 'New task',
        description: 'Task details',
        project: 24,
      },
      [
        {
          originalname: 'brief.txt',
          buffer: Buffer.from('hello'),
          size: 5,
        },
      ],
    )

    expect(bitrixService.addTimelineComment).toHaveBeenCalledWith({
      entityId: 123,
      entityType: 'DYNAMIC_1072',
      comment: 'Task details',
    })
    expect(bitrixService.updateTimelineComment).toHaveBeenCalledWith({
      id: 555,
      ownerTypeId: EntityTypeIds.tasks,
      ownerId: 123,
      comment: 'Task details',
      files: [['brief.txt', Buffer.from('hello').toString('base64')]],
    })
    expect(result).toMatchObject({
      timelineCommentId: 555,
      attachedFilesCount: 1,
    })
  })

  it('approves current client task and moves it to backlog', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.getItem.mockResolvedValue({
      id: 123,
      stageId: TaskStageIds.approval,
      [TaskCodes.client]: 42,
    })
    bitrixService.updateItem.mockResolvedValue({
      id: 123,
      stageId: TaskStageIds.backlog,
      [TaskCodes.client]: 42,
    })

    const result = await service.approveMyTask(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      123,
    )

    expect(bitrixService.getItem).toHaveBeenCalledWith({
      entityTypeId: EntityTypeIds.tasks,
      id: 123,
    })
    expect(bitrixService.updateItem).toHaveBeenCalledWith({
      entityTypeId: EntityTypeIds.tasks,
      id: 123,
      fields: {
        stageId: TaskStageIds.backlog,
      },
    })
    expect(result).toEqual({
      id: 123,
      stageId: TaskStageIds.backlog,
      status: 'Backlog',
    })
  })

  it('rejects approving task from another client', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.getItem.mockResolvedValue({
      id: 123,
      stageId: TaskStageIds.approval,
      [TaskCodes.client]: 99,
    })

    await expect(
      service.approveMyTask(
        {
          sub: 1,
          email: 'client@example.com',
          crmClientId: 42,
          role: 'client',
        },
        123,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(bitrixService.updateItem).not.toHaveBeenCalled()
  })

  it('rejects approving task that is not waiting for client approval', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.getItem.mockResolvedValue({
      id: 123,
      stageId: TaskStageIds.backlog,
      [TaskCodes.client]: 42,
    })

    await expect(
      service.approveMyTask(
        {
          sub: 1,
          email: 'client@example.com',
          crmClientId: 42,
          role: 'client',
        },
        123,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(bitrixService.updateItem).not.toHaveBeenCalled()
  })

  it('rejects current client task proposal when client PM is missing', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([])

    await expect(
      service.createMyTaskProposal(
        {
          sub: 1,
          email: 'client@example.com',
          crmClientId: 42,
          role: 'client',
        },
        {
          title: 'New task',
          description: 'Task details',
          project: 24,
        },
      ),
    ).rejects.toThrow('Client PM not found')
    expect(bitrixService.addItem).not.toHaveBeenCalled()
  })

  it('returns period stats for tasks and communications', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems
      .mockResolvedValueOnce([
        {
          id: '1',
          [TaskCodes.hours]: '2.5',
        },
        {
          id: '2',
          [TaskCodes.hours]: '3,25',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '10',
          [DailyReportCodes.timeSpent]: '1.5',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '11',
          [DailyReportCodes.timeSpent]: '2',
        },
      ])

    const result = await service.getMyStats(
      {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
      {
        start: '2026-05-01',
        end: '2026-05-14',
      },
    )

    expect(result).toMatchObject({
      purchasedHours: null,
      period: {
        start: '2026-05-01',
        end: '2026-05-14',
      },
      tasks: {
        count: 2,
        totalTime: 5.75,
      },
      communications: {
        totalTime: 3.5,
        internal: {
          activityType: '402',
          count: 1,
          totalTime: 1.5,
        },
        external: {
          activityType: '417',
          count: 1,
          totalTime: 2,
        },
      },
    })
  })

  it('formats team roles with users', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([
      {
        id: 10,
        title: 'Project',
        assignedById: 7,
        [ClientsCodes.client]: 42,
      },
    ])
    bitrixService.getUsersByIds.mockResolvedValue([
      {
        id: '7',
        title: 'Ada Lovelace',
        name: 'Ada',
        lastName: 'Lovelace',
      },
    ])

    const result = await service.getMyTeam({
      sub: 1,
      email: 'client@example.com',
      crmClientId: 42,
      role: 'client',
    })

    expect(result.roles[0]).toMatchObject({
      roleCode: 'pm',
      roleTitle: 'PM',
      userIds: [7],
      users: [
        {
          id: '7',
          title: 'Ada Lovelace',
        },
      ],
    })
  })

  it('rejects inactive clients', async () => {
    clientsRepository.findOne.mockResolvedValue({
      ...client,
      status: ClientStatus.Inactive,
    })

    await expect(
      service.getMyProjects({
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('updates admin-managed client profile fields', async () => {
    const currentClient = {
      ...client,
      name: 'Old name',
      email: 'old@example.com',
      crmClientId: 42,
      purchasedHours: null,
    } as Client
    const savedClient = {
      ...currentClient,
      name: 'New name',
      email: 'new@example.com',
      crmClientId: 43,
      status: ClientStatus.Inactive,
      purchasedHours: 12.35,
    } as Client

    clientsRepository.findOne
      .mockResolvedValueOnce(currentClient)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    clientsRepository.save.mockResolvedValue(savedClient)

    const result = await service.update(1, {
      name: 'New name',
      email: 'new@example.com',
      crmId: 43,
      status: ClientStatus.Inactive,
      purchasedHours: 12.345,
    })

    expect(clientsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New name',
        email: 'new@example.com',
        crmClientId: 43,
        status: ClientStatus.Inactive,
        purchasedHours: 12.35,
      }),
    )
    expect(result).toMatchObject({
      name: 'New name',
      email: 'new@example.com',
      crmClientId: 43,
      status: ClientStatus.Inactive,
      purchasedHours: 12.35,
    })
  })

  it('rejects client update when email is already used by another client', async () => {
    clientsRepository.findOne
      .mockResolvedValueOnce({
        ...client,
        email: 'current@example.com',
      } as Client)
      .mockResolvedValueOnce({
        id: 2,
      } as Client)

    await expect(
      service.update(1, {
        email: 'busy@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('adds purchased hours and writes timeline event', async () => {
    const clientWithHours = {
      ...client,
      purchasedHours: null,
    } as Client
    const savedClient = {
      ...clientWithHours,
      purchasedHours: 10,
    } as Client

    transactionalClientsRepository.findOne.mockResolvedValue(clientWithHours)
    transactionalClientsRepository.save.mockResolvedValue(savedClient)
    transactionalPurchasedHoursEventsRepository.create.mockReturnValue({
      clientId: 1,
      type: ClientPurchasedHoursEventType.Added,
      hours: 10,
      balanceAfter: 10,
      comment: 'Paid invoice',
    })
    dataSource.transaction.mockImplementation((callback) =>
      callback({
        getRepository: (entity: unknown) =>
          entity === Client
            ? transactionalClientsRepository
            : transactionalPurchasedHoursEventsRepository,
      }),
    )

    const result = await service.addPurchasedHours(1, {
      hours: 10,
      comment: ' Paid invoice ',
    })

    expect(result).toMatchObject({
      purchasedHours: 10,
      hasPurchasedHours: true,
    })
    expect(transactionalPurchasedHoursEventsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 1,
        type: ClientPurchasedHoursEventType.Added,
        hours: 10,
        balanceAfter: 10,
        comment: 'Paid invoice',
      }),
    )
  })

  it('removes purchased hours and keeps zero as an explicit balance', async () => {
    const clientWithHours = {
      ...client,
      purchasedHours: 5,
    } as Client
    const savedClient = {
      ...clientWithHours,
      purchasedHours: 0,
    } as Client

    transactionalClientsRepository.findOne.mockResolvedValue(clientWithHours)
    transactionalClientsRepository.save.mockResolvedValue(savedClient)
    transactionalPurchasedHoursEventsRepository.create.mockReturnValue({
      clientId: 1,
      type: ClientPurchasedHoursEventType.Removed,
      hours: 5,
      balanceAfter: 0,
      comment: null,
    })
    dataSource.transaction.mockImplementation((callback) =>
      callback({
        getRepository: (entity: unknown) =>
          entity === Client
            ? transactionalClientsRepository
            : transactionalPurchasedHoursEventsRepository,
      }),
    )

    const result = await service.removePurchasedHours(1, {
      hours: 5,
    })

    expect(result).toMatchObject({
      purchasedHours: 0,
      hasPurchasedHours: true,
    })
    expect(transactionalPurchasedHoursEventsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ClientPurchasedHoursEventType.Removed,
        hours: 5,
        balanceAfter: 0,
      }),
    )
  })

  it('rejects removing more purchased hours than client has', async () => {
    transactionalClientsRepository.findOne.mockResolvedValue({
      ...client,
      purchasedHours: 3,
    })
    dataSource.transaction.mockImplementation((callback) =>
      callback({
        getRepository: (entity: unknown) =>
          entity === Client
            ? transactionalClientsRepository
            : transactionalPurchasedHoursEventsRepository,
      }),
    )

    await expect(
      service.removePurchasedHours(1, {
        hours: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
