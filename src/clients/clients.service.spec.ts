import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Test, TestingModule } from '@nestjs/testing'
import {
  ClientsCodes,
  DailyReportCodes,
  EntityTypeIds,
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
    getItem: jest.fn(),
    listAllItems: jest.fn(),
    getUsersByIds: jest.fn(),
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

  it('loads current client tasks through server-side Bitrix integration', async () => {
    clientsRepository.findOne.mockResolvedValue(client)
    bitrixService.listAllItems.mockResolvedValue([])

    await service.getMyTasks({
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
      }),
    )
  })

  it('loads current client tasks by sprint period when dates are provided', async () => {
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
          [TaskCodes.client]: 42,
          [`>=${TaskCodes.sprintDateStart}`]: '2026-05-01',
          [`<=${TaskCodes.sprintDateStart}`]: '2026-05-14',
        }),
      }),
    )
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
