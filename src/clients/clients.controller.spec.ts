import { JwtService } from '@nestjs/jwt'
import { Test, TestingModule } from '@nestjs/testing'
import { ClientsController } from './clients.controller'
import { ClientsService } from './clients.service'

describe('ClientsController', () => {
  let controller: ClientsController

  const clientsService = {
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
})
