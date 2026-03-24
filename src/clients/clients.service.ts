import { ConflictException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { genSalt, hash } from 'bcryptjs'
import { Repository } from 'typeorm'
import { toClientResponseDto } from './clients.mapper'
import { ClientResponseDto } from './dto/client-response.dto'
import { CreateClientDto } from './dto/create-client.dto'
import { Client } from './entities/client.entity'

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
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
    })

    const savedClient = await this.clientsRepository.save(client)

    return toClientResponseDto(savedClient)
  }

  async findAll(): Promise<ClientResponseDto[]> {
    const clients = await this.clientsRepository.find({
      order: {
        id: 'DESC',
      },
    })

    return clients.map(toClientResponseDto)
  }
}
