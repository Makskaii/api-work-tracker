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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import {
  GANTT_INCIDENT_MAX_FILE_SIZE,
  GANTT_INCIDENT_MAX_FILES,
} from 'src/constants/const'
import { CreateGanttEventDto } from './dto/create-gantt-event.dto'
import { CreateGanttIncidentDto } from './dto/create-gantt-incident.dto'
import { UpdateGanttEventDto } from './dto/update-gantt-event.dto'
import { UpdateGanttIncidentDto } from './dto/update-gantt-incident.dto'
import { GanttCustomEvent } from './entities/gantt-custom-event.entity'
import { GanttIncidentFile } from './entities/gantt-incident-file.entity'
import { GanttIncident } from './entities/gantt-incident.entity'
import { GanttService, GanttUploadedFile } from './gantt.service'

@Controller('gantt')
export class GanttController {
  constructor(private readonly ganttService: GanttService) {}

  @Get('projects/:projectId/events')
  findProjectEvents(
    @Param('projectId') projectId: string,
  ): Promise<GanttCustomEvent[]> {
    return this.ganttService.findProjectEvents(projectId)
  }

  @Post('projects/:projectId/events')
  createProjectEvent(
    @Param('projectId') projectId: string,
    @Body() dto: CreateGanttEventDto,
  ): Promise<GanttCustomEvent> {
    return this.ganttService.createProjectEvent(projectId, dto)
  }

  @Patch('events/:eventId')
  updateEvent(
    @Param('eventId', ParseIntPipe) eventId: number,
    @Body() dto: UpdateGanttEventDto,
  ): Promise<GanttCustomEvent> {
    return this.ganttService.updateEvent(eventId, dto)
  }

  @Delete('events/:eventId')
  @HttpCode(204)
  deleteEvent(@Param('eventId', ParseIntPipe) eventId: number): Promise<void> {
    return this.ganttService.deleteEvent(eventId)
  }

  @Get('projects/:projectId/incidents')
  findProjectIncidents(
    @Param('projectId') projectId: string,
  ): Promise<GanttIncident[]> {
    return this.ganttService.findProjectIncidents(projectId)
  }

  @Post('projects/:projectId/incidents')
  createProjectIncident(
    @Param('projectId') projectId: string,
    @Body() dto: CreateGanttIncidentDto,
  ): Promise<GanttIncident> {
    return this.ganttService.createProjectIncident(projectId, dto)
  }

  @Patch('incidents/:incidentId')
  updateIncident(
    @Param('incidentId', ParseIntPipe) incidentId: number,
    @Body() dto: UpdateGanttIncidentDto,
  ): Promise<GanttIncident> {
    return this.ganttService.updateIncident(incidentId, dto)
  }

  @Delete('incidents/:incidentId')
  @HttpCode(204)
  deleteIncident(
    @Param('incidentId', ParseIntPipe) incidentId: number,
  ): Promise<void> {
    return this.ganttService.deleteIncident(incidentId)
  }

  @Post('incidents/:incidentId/files')
  @UseInterceptors(
    FilesInterceptor('files', GANTT_INCIDENT_MAX_FILES, {
      limits: {
        fileSize: GANTT_INCIDENT_MAX_FILE_SIZE,
      },
    }),
  )
  addIncidentFiles(
    @Param('incidentId', ParseIntPipe) incidentId: number,
    @UploadedFiles() files: GanttUploadedFile[] = [],
  ): Promise<GanttIncidentFile[]> {
    return this.ganttService.addIncidentFiles(incidentId, files)
  }

  @Get('incidents/:incidentId/files/:fileId')
  @Header('Content-Disposition', 'attachment')
  async getIncidentFile(
    @Param('incidentId', ParseIntPipe) incidentId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { file, stream } = await this.ganttService.getIncidentFile(
      incidentId,
      fileId,
    )

    response.setHeader('Content-Type', file.mimeType)
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    )

    return new StreamableFile(stream)
  }

  @Delete('incidents/:incidentId/files/:fileId')
  @HttpCode(204)
  deleteIncidentFile(
    @Param('incidentId', ParseIntPipe) incidentId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
  ): Promise<void> {
    return this.ganttService.deleteIncidentFile(incidentId, fileId)
  }
}

