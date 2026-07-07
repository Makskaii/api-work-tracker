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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import type { AuthenticatedClientRequest } from 'src/auth/client-jwt.guard'
import { ClientJwtGuard } from 'src/auth/client-jwt.guard'
import {
  CLIENT_TASK_PROPOSAL_MAX_FILE_SIZE,
  CLIENT_TASK_PROPOSAL_MAX_FILES,
} from 'src/constants/const'
import { ClientsService } from './clients.service'
import { ApproveClientTaskResponseDto } from './dto/approve-client-task-response.dto'
import { ChangeClientPurchasedHoursDto } from './dto/change-client-purchased-hours.dto'
import {
  ClientCompanyDto,
  ClientProjectDto,
  ClientStatsDto,
  ClientTeamDto,
} from './dto/client-bitrix-response.dto'
import { ClientPurchasedHoursEventResponseDto } from './dto/client-purchased-hours-event-response.dto'
import { ClientResponseDto } from './dto/client-response.dto'
import { ClientTaskResponseDto } from './dto/client-task-response.dto'
import { CreateClientDto } from './dto/create-client.dto'
import {
  ClientTaskProposalFile,
  ClientTaskProposalResponseDto,
  CreateClientTaskProposalDto,
} from './dto/create-client-task-proposal.dto'
import { GetClientStatsQueryDto } from './dto/get-client-stats-query.dto'
import { GetClientTasksQueryDto } from './dto/get-client-tasks-query.dto'
import { GetClientsQueryDto } from './dto/get-clients-query.dto'
import { UpdateClientDto } from './dto/update-client.dto'

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

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateClientDto: UpdateClientDto,
  ): Promise<ClientResponseDto> {
    return this.clientsService.update(id, updateClientDto)
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
  ): Promise<ClientTaskResponseDto[]> {
    return this.clientsService.getMyTasks(request.client, query)
  }

  @Post('me/tasks/proposals')
  @UseGuards(ClientJwtGuard)
  @UseInterceptors(
    FilesInterceptor('files', CLIENT_TASK_PROPOSAL_MAX_FILES, {
      limits: {
        fileSize: CLIENT_TASK_PROPOSAL_MAX_FILE_SIZE,
      },
    }),
  )
  createMyTaskProposal(
    @Req() request: AuthenticatedClientRequest,
    @Body() dto: CreateClientTaskProposalDto,
    @UploadedFiles() files: ClientTaskProposalFile[] = [],
  ): Promise<ClientTaskProposalResponseDto> {
    return this.clientsService.createMyTaskProposal(request.client, dto, files)
  }

  @Patch('me/tasks/:id/approve')
  @UseGuards(ClientJwtGuard)
  approveMyTask(
    @Req() request: AuthenticatedClientRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ApproveClientTaskResponseDto> {
    return this.clientsService.approveMyTask(request.client, id)
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

  @Post(':id/purchased-hours')
  addPurchasedHours(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeClientPurchasedHoursDto,
  ): Promise<ClientResponseDto> {
    return this.clientsService.addPurchasedHours(id, dto)
  }

  @Delete(':id/purchased-hours')
  removePurchasedHours(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeClientPurchasedHoursDto,
  ): Promise<ClientResponseDto> {
    return this.clientsService.removePurchasedHours(id, dto)
  }

  @Get(':id/purchased-hours/events')
  getPurchasedHoursEvents(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ClientPurchasedHoursEventResponseDto[]> {
    return this.clientsService.getPurchasedHoursEvents(id)
  }

  @Delete(':id/purchased-hours/events/:eventId')
  removePurchasedHoursEvent(
    @Param('id', ParseIntPipe) id: number,
    @Param('eventId', ParseIntPipe) eventId: number,
  ): Promise<ClientResponseDto> {
    return this.clientsService.removePurchasedHoursEvent(id, eventId)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.clientsService.remove(id)
  }
}
