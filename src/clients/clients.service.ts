import { ConflictException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateClientDto } from './dto/create-client.dto'
import { Client } from './entities/client.entity'

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
  ) {}

  async create(createClientDto: CreateClientDto): Promise<Client> {
    const existingClient = await this.clientsRepository.findOne({
      where: { crmClientId: createClientDto.crmId },
    })

    if (existingClient) {
      throw new ConflictException('Client with this crmClientId already exists')
    }
    console.log(createClientDto)
    const client = this.clientsRepository.create({
      name: createClientDto.name,
      crmClientId: createClientDto.crmId,
    })

    return this.clientsRepository.save(client)
  }

  async findAll(): Promise<Client[]> {
    return await this.clientsRepository.find({
      order: {
        id: 'DESC',
      },
    })
  }
}
