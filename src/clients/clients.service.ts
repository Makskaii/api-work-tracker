import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { genSalt, hash } from 'bcryptjs'
import { FindOptionsWhere, Like, Repository } from 'typeorm'
import { toClientResponseDto } from './clients.mapper'
import { ClientResponseDto } from './dto/client-response.dto'
import { CreateClientDto } from './dto/create-client.dto'
import { GetClientsQueryDto } from './dto/get-clients-query.dto'
import { Client, ClientStatus } from './entities/client.entity'

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
