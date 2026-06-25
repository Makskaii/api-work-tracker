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
import type { Response } from 'express'
import { REPORT_PROJECT_MAX_FILE_SIZE } from 'src/constants/const'
import { CreateProjectGanttEventDto } from './dto/create-project-gantt-event.dto'
import { CreateProjectGanttStageDto } from './dto/create-project-gantt-stage.dto'
import { CreateProjectPaymentDto } from './dto/create-project-payment.dto'
import { CreateProjectReportEntryDto } from './dto/create-project-report-entry.dto'
import { CreateReportProjectDto } from './dto/create-project-report-project.dto'
import { UpdateProjectGanttEventDto } from './dto/update-project-gantt-event.dto'
import { UpdateProjectGanttStageDto } from './dto/update-project-gantt-stage.dto'
import { UpdateProjectPaymentDto } from './dto/update-project-payment.dto'
import { UpdateProjectReportEntryDto } from './dto/update-project-report-entry.dto'
import { UpdateReportProjectDto } from './dto/update-project-report-project.dto'
import { ProjectGanttEvent } from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ProjectReportEntryFile } from './entities/project-report-entry-file.entity'
import { ProjectReportEntry } from './entities/project-report-entry.entity'
import { ReportProject } from './entities/project-report-project.entity'
import { ReportProjectFile, ReportProjectFileKind } from './entities/report-project-file.entity'
import { ProjectGanttService } from './project-gantt.service'
import { ProjectPaymentsService } from './project-payments.service'
import { ProjectReportEntriesService } from './project-report-entries.service'
import { ProjectReportFilesService } from './project-report-files.service'
import { ProjectReportsService } from './project-reports.service'
import type { ReportProjectUploadedFile } from './project-reports.types'

@Controller('project-reports')
export class ProjectReportsController {
  constructor(
    private readonly projectReportsService: ProjectReportsService,
    private readonly projectReportFilesService: ProjectReportFilesService,
    private readonly projectReportEntriesService: ProjectReportEntriesService,
    private readonly projectGanttService: ProjectGanttService,
    private readonly projectPaymentsService: ProjectPaymentsService,
  ) {}

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
    return this.projectReportFilesService.addProjectFile(projectId, fileKind, file)
  }

  @Get('projects/:projectId/files/:fileId')
  @Header('Content-Disposition', 'attachment')
  async getProjectFile(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.projectReportFilesService.getProjectFile(
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
    return this.projectReportFilesService.deleteProjectFile(projectId, fileId)
  }

  @Get('projects/:projectId/reports')
  findProjectReportEntries(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<ProjectReportEntry[]> {
    return this.projectReportEntriesService.findProjectReportEntries(projectId)
  }

  @Post('projects/:projectId/reports')
  createProjectReportEntry(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateProjectReportEntryDto,
  ): Promise<ProjectReportEntry> {
    return this.projectReportEntriesService.createProjectReportEntry(projectId, dto)
  }

  @Patch('projects/:projectId/reports/:reportId')
  updateProjectReportEntry(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('reportId', ParseIntPipe) reportId: number,
    @Body() dto: UpdateProjectReportEntryDto,
  ): Promise<ProjectReportEntry> {
    return this.projectReportEntriesService.updateProjectReportEntry(
      projectId,
      reportId,
      dto,
    )
  }

  @Delete('projects/:projectId/reports/:reportId')
  @HttpCode(204)
  deleteProjectReportEntry(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('reportId', ParseIntPipe) reportId: number,
  ): Promise<void> {
    return this.projectReportEntriesService.deleteProjectReportEntry(projectId, reportId)
  }

  @Post('projects/:projectId/reports/:reportId/files')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: REPORT_PROJECT_MAX_FILE_SIZE,
      },
    }),
  )
  addProjectReportEntryFile(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('reportId', ParseIntPipe) reportId: number,
    @UploadedFile() file?: ReportProjectUploadedFile,
  ): Promise<ProjectReportEntryFile> {
    return this.projectReportEntriesService.addProjectReportEntryFile(
      projectId,
      reportId,
      file,
    )
  }

  @Get('projects/:projectId/reports/:reportId/files/:fileId')
  @Header('Content-Disposition', 'attachment')
  async getProjectReportEntryFile(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('reportId', ParseIntPipe) reportId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { file, stream } =
      await this.projectReportEntriesService.getProjectReportEntryFile(
        projectId,
        reportId,
        fileId,
      )

    response.setHeader('Content-Type', file.mimeType)
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    )

    return new StreamableFile(stream)
  }

  @Delete('projects/:projectId/reports/:reportId/files/:fileId')
  @HttpCode(204)
  deleteProjectReportEntryFile(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Param('reportId', ParseIntPipe) reportId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ): Promise<void> {
    return this.projectReportEntriesService.deleteProjectReportEntryFile(
      projectId,
      reportId,
      fileId,
    )
  }

  @Get('projects/:projectId/gantt/stages')
  findProjectStages(
    @Param('projectId') projectId: string,
  ): Promise<ProjectGanttStage[]> {
    return this.projectGanttService.findProjectStages(projectId)
  }

  @Post('projects/:projectId/gantt/stages')
  createProjectStage(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectGanttStageDto,
  ): Promise<ProjectGanttStage> {
    return this.projectGanttService.createProjectStage(projectId, dto)
  }

  @Patch('gantt/stages/:stageId')
  updateStage(
    @Param('stageId', ParseIntPipe) stageId: number,
    @Body() dto: UpdateProjectGanttStageDto,
  ): Promise<ProjectGanttStage> {
    return this.projectGanttService.updateStage(stageId, dto)
  }

  @Delete('gantt/stages/:stageId')
  @HttpCode(204)
  deleteStage(@Param('stageId', ParseIntPipe) stageId: number): Promise<void> {
    return this.projectGanttService.deleteStage(stageId)
  }

  @Get('projects/:projectId/gantt/events')
  findProjectEvents(
    @Param('projectId') projectId: string,
  ): Promise<ProjectGanttEvent[]> {
    return this.projectGanttService.findProjectEvents(projectId)
  }

  @Post('projects/:projectId/gantt/events')
  createProjectEvent(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectGanttEventDto,
  ): Promise<ProjectGanttEvent> {
    return this.projectGanttService.createProjectEvent(projectId, dto)
  }

  @Patch('gantt/events/:eventId')
  updateEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: UpdateProjectGanttEventDto,
  ): Promise<ProjectGanttEvent> {
    return this.projectGanttService.updateEvent(eventId, dto)
  }

  @Delete('gantt/events/:eventId')
  @HttpCode(204)
  deleteEvent(@Param('eventId', ParseIntPipe) eventId: number): Promise<void> {
    return this.projectGanttService.deleteEvent(eventId)
  }

  @Get('projects/:projectId/payments')
  findProjectPayments(
    @Param('projectId') projectId: string,
  ): Promise<ProjectPayment[]> {
    return this.projectPaymentsService.findProjectPayments(projectId)
  }

  @Post('projects/:projectId/payments')
  createProjectPayment(
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    return this.projectPaymentsService.createProjectPayment(projectId, dto)
  }

  @Patch('payments/:paymentId')
  updatePayment(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() dto: UpdateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    return this.projectPaymentsService.updatePayment(paymentId, dto)
  }

  @Delete('payments/:paymentId')
  @HttpCode(204)
  deletePayment(
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ): Promise<void> {
    return this.projectPaymentsService.deletePayment(paymentId)
  }
}
