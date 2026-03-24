import { Body, Controller, Get, Post } from '@nestjs/common'
import { ClientsService } from './clients.service'
import { ClientResponseDto } from './dto/client-response.dto'
import { CreateClientDto } from './dto/create-client.dto'

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(@Body() createClientDto: CreateClientDto): Promise<ClientResponseDto> {
    return this.clientsService.create(createClientDto)
  }

  @Get()
  findAll(): Promise<ClientResponseDto[]> {
    return this.clientsService.findAll()
  }
}
