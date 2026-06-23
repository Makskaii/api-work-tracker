import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Response } from 'express'
import { REPORT_PROJECT_MAX_FILE_SIZE } from 'src/constants/const'
import { CreateProjectGanttEventDto } from './dto/create-project-gantt-event.dto'
import { CreateProjectGanttStageDto } from './dto/create-project-gantt-stage.dto'
import { CreateProjectPaymentDto } from './dto/create-project-payment.dto'
import { CreateReportProjectDto } from './dto/create-project-report-project.dto'
import { UpdateProjectGanttEventDto } from './dto/update-project-gantt-event.dto'
import { UpdateProjectGanttStageDto } from './dto/update-project-gantt-stage.dto'
import { UpdateProjectPaymentDto } from './dto/update-project-payment.dto'
import { UpdateReportProjectDto } from './dto/update-project-report-project.dto'
import { ProjectGanttEvent } from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ReportProject } from './entities/project-report-project.entity'
import { ReportProjectFile, ReportProjectFileKind } from './entities/report-project-file.entity'
import {
  ProjectReportsService,
  ReportProjectUploadedFile,
} from './project-reports.service'

@Controller('project-reports')
export class ProjectReportsController {
  constructor(private readonly projectReportsService: ProjectReportsService) {}

  @Get('projects')
  findProjects(): Promise<ReportProject[]> {
    return this.projectReportsService.findProjects()
  }

  @Post('projects')
  createProject(
    @Body() dto: CreateReportProjectDto,
  ): Promise<ReportProject> {
    return this.projectReportsService.createProject(dto)
  }

  @Get('projects/:projectId')
  findProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<ReportProject> {
    return this.projectReportsService.findProject(projectId)
  }

  @Patch('projects/:projectId')
  updateProject(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: UpdateReportProjectDto,
  ): Promise<ReportProject> {
    return this.projectReportsService.updateProject(projectId, dto)
  }

  @Delete('projects/:projectId')
  @HttpCode(204)
  deleteProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<void> {
    return this.projectReportsService.deleteProject(projectId)
  }

  @Post('projects/:projectId/files/:fileKind')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: REPORT_PROJECT_MAX_FILE_SIZE,
      },
    }),
  )
  addProjectFile(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('fileKind') fileKind: ReportProjectFileKind,
    @UploadedFile() file?: ReportProjectUploadedFile,
  ): Promise<ReportProjectFile> {
    return this.projectReportsService.addProjectFile(projectId, fileKind, file)
  }

  @Get('projects/:projectId/files/:fileId')
  @Header('Content-Disposition', 'attachment')
  async getProjectFile(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.projectReportsService.getProjectFile(
      projectId,
      fileId,
    )

    response.setHeader('Content-Type', file.mimeType)
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    )

    return new StreamableFile(stream)
  }

  @Delete('projects/:projectId/files/:fileId')
  @HttpCode(204)
  deleteProjectFile(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ): Promise<void> {
    return this.projectReportsService.deleteProjectFile(projectId, fileId)
  }

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
