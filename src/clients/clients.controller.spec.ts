import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { ClientsController } from './clients.controller'
import { ClientsService } from './clients.service'

describe('ClientsController', () => {
  let controller: ClientsController

  const clientsService = {
    approveMyTask: jest.fn(),
    createMyTaskProposal: jest.fn(),
    findAll: jest.fn(),
    getMyCompany: jest.fn(),
    getMyProjects: jest.fn(),
    getMyTasks: jest.fn(),
    getMyStats: jest.fn(),
    getMyTeam: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        {
          provide: ClientsService,
          useValue: clientsService,
        },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: jest.fn(),
          },
        },
      ],
    }).compile()

    controller = module.get<ClientsController>(ClientsController)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('delegates task proposal creation to service', async () => {
    const request = {
      client: {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
    }
    const dto = {
      title: 'New task',
      description: 'Task details',
      project: 24,
    }
    const response = {
      id: 123,
      title: 'New task',
      description: 'Task details',
      assignedById: 7,
      stageId: 'DT1072_18:UC_8NADXD',
      timelineCommentId: null,
      attachedFilesCount: 0,
    }
    const files = [
      {
        originalname: 'brief.txt',
        buffer: Buffer.from('hello'),
        size: 5,
      },
    ]

    clientsService.createMyTaskProposal.mockResolvedValue(response)

    await expect(
      controller.createMyTaskProposal(request as never, dto, files),
    ).resolves.toBe(response)
    expect(clientsService.createMyTaskProposal).toHaveBeenCalledWith(
      request.client,
      dto,
      files,
    )
  })

  it('delegates task approval to service', async () => {
    const request = {
      client: {
        sub: 1,
        email: 'client@example.com',
        crmClientId: 42,
        role: 'client',
      },
    }
    const response = {
      id: 123,
      stageId: 'DT1072_18:NEW',
      status: 'Backlog',
    }

    clientsService.approveMyTask.mockResolvedValue(response)

    await expect(
      controller.approveMyTask(request as never, 123),
    ).resolves.toBe(response)
    expect(clientsService.approveMyTask).toHaveBeenCalledWith(
      request.client,
      123,
    )
  })
})
