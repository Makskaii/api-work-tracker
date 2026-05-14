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
  Req,
  UseGuards,
} from '@nestjs/common'
import type { AuthenticatedClientRequest } from 'src/auth/client-jwt.guard'
import { ClientJwtGuard } from 'src/auth/client-jwt.guard'
import { TaskProps } from 'src/types/tasks'
import { ClientsService } from './clients.service'
import {
  ClientCompanyDto,
  ClientProjectDto,
  ClientStatsDto,
  ClientTeamDto,
} from './dto/client-bitrix-response.dto'
import { ClientResponseDto } from './dto/client-response.dto'
import { CreateClientDto } from './dto/create-client.dto'
import { GetClientStatsQueryDto } from './dto/get-client-stats-query.dto'
import { GetClientTasksQueryDto } from './dto/get-client-tasks-query.dto'
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

  @Get('me/company')
  @UseGuards(ClientJwtGuard)
  getMyCompany(
    @Req() request: AuthenticatedClientRequest,
  ): Promise<ClientCompanyDto> {
    return this.clientsService.getMyCompany(request.client)
  }

  @Get('me/projects')
  @UseGuards(ClientJwtGuard)
  getMyProjects(
    @Req() request: AuthenticatedClientRequest,
  ): Promise<ClientProjectDto[]> {
    return this.clientsService.getMyProjects(request.client)
  }

  @Get('me/tasks')
  @UseGuards(ClientJwtGuard)
  getMyTasks(
    @Req() request: AuthenticatedClientRequest,
    @Query() query: GetClientTasksQueryDto,
  ): Promise<TaskProps[]> {
    return this.clientsService.getMyTasks(request.client, query)
  }

  @Get('me/stats')
  @UseGuards(ClientJwtGuard)
  getMyStats(
    @Req() request: AuthenticatedClientRequest,
    @Query() query: GetClientStatsQueryDto,
  ): Promise<ClientStatsDto> {
    return this.clientsService.getMyStats(request.client, query)
  }

  @Get('me/team')
  @UseGuards(ClientJwtGuard)
  getMyTeam(
    @Req() request: AuthenticatedClientRequest,
  ): Promise<ClientTeamDto> {
    return this.clientsService.getMyTeam(request.client)
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
