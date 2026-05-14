import { ForbiddenException } from '@nestjs/common'
import { getRepositoryToken } from '@nestjs/typeorm'
import { Test, TestingModule } from '@nestjs/testing'
import {
  ClientsCodes,
  DailyReportCodes,
  EntityTypeIds,
  TaskCodes,
} from 'src/constants/const'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { ClientsService } from './clients.service'
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
})
