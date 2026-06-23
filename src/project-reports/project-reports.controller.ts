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
} from '@nestjs/common'
import { CreateProjectGanttEventDto } from './dto/create-project-gantt-event.dto'
import { CreateProjectGanttStageDto } from './dto/create-project-gantt-stage.dto'
import { CreateProjectPaymentDto } from './dto/create-project-payment.dto'
import { UpdateProjectGanttEventDto } from './dto/update-project-gantt-event.dto'
import { UpdateProjectGanttStageDto } from './dto/update-project-gantt-stage.dto'
import { UpdateProjectPaymentDto } from './dto/update-project-payment.dto'
import { ProjectGanttEvent } from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ProjectReportsService } from './project-reports.service'

@Controller('project-reports')
export class ProjectReportsController {
  constructor(private readonly projectReportsService: ProjectReportsService) {}

  @Get('projects/:projectId/gantt/stages')
  findProjectStages(
    @Param('projectId') projectId: string,
  ): Promise<ProjectGanttStage[]> {
    return this.projectReportsService.findProjectStages(projectId)
  }

  @Post('projects/:projectId/gantt/stages')
  createProjectStage(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectGanttStageDto,
  ): Promise<ProjectGanttStage> {
    return this.projectReportsService.createProjectStage(projectId, dto)
  }

  @Patch('gantt/stages/:stageId')
  updateStage(
    @Param('stageId', ParseIntPipe) stageId: number,
    @Body() dto: UpdateProjectGanttStageDto,
  ): Promise<ProjectGanttStage> {
    return this.projectReportsService.updateStage(stageId, dto)
  }

  @Delete('gantt/stages/:stageId')
  @HttpCode(204)
  deleteStage(@Param('stageId', ParseIntPipe) stageId: number): Promise<void> {
    return this.projectReportsService.deleteStage(stageId)
  }

  @Get('projects/:projectId/gantt/events')
  findProjectEvents(
    @Param('projectId') projectId: string,
  ): Promise<ProjectGanttEvent[]> {
    return this.projectReportsService.findProjectEvents(projectId)
  }

  @Post('projects/:projectId/gantt/events')
  createProjectEvent(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectGanttEventDto,
  ): Promise<ProjectGanttEvent> {
    return this.projectReportsService.createProjectEvent(projectId, dto)
  }

  @Patch('gantt/events/:eventId')
  updateEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: UpdateProjectGanttEventDto,
  ): Promise<ProjectGanttEvent> {
    return this.projectReportsService.updateEvent(eventId, dto)
  }

  @Delete('gantt/events/:eventId')
  @HttpCode(204)
  deleteEvent(@Param('eventId', ParseIntPipe) eventId: number): Promise<void> {
    return this.projectReportsService.deleteEvent(eventId)
  }

  @Get('projects/:projectId/payments')
  findProjectPayments(
    @Param('projectId') projectId: string,
  ): Promise<ProjectPayment[]> {
    return this.projectReportsService.findProjectPayments(projectId)
  }

  @Post('projects/:projectId/payments')
  createProjectPayment(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    return this.projectReportsService.createProjectPayment(projectId, dto)
  }

  @Patch('payments/:paymentId')
  updatePayment(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() dto: UpdateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    return this.projectReportsService.updatePayment(paymentId, dto)
  }

  @Delete('payments/:paymentId')
  @HttpCode(204)
  deletePayment(
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ): Promise<void> {
    return this.projectReportsService.deletePayment(paymentId)
  }
}
