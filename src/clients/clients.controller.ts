import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { ClientsService } from './clients.service'
import { ClientResponseDto } from './dto/client-response.dto'
import { CreateClientDto } from './dto/create-client.dto'
import { GetClientsQueryDto } from './dto/get-clients-query.dto'

@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(@Body() createClientDto: CreateClientDto): Promise<ClientResponseDto> {
    return this.clientsService.create(createClientDto)
  }

  @Get()
  findAll(@Query() query: GetClientsQueryDto): Promise<ClientResponseDto[]> {
    return this.clientsService.findAll(query)
  }

  @Patch(':id/deactivate')
  deactivate(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClientResponseDto> {
    return this.clientsService.deactivate(id)
  }

  @Patch(':id/activate')
  activate(@Param('id', ParseIntPipe) id: number): Promise<ClientResponseDto> {
    return this.clientsService.activate(id)
  }

  @Patch(':id/status/toggle')
  toggleStatus(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClientResponseDto> {
    return this.clientsService.toggleStatus(id)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.clientsService.remove(id)
  }
}
