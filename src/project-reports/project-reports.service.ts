import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { CreateReportProjectDto } from './dto/create-project-report-project.dto'
import { ProjectReportsPlanQueryDto } from './dto/project-reports-plan-query.dto'
import { UpdateReportProjectDto } from './dto/update-project-report-project.dto'
import { ProjectReportEntry } from './entities/project-report-entry.entity'
import { ProjectGanttEvent } from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ReportProject } from './entities/project-report-project.entity'

@Injectable()
export class ProjectReportsService {
  constructor(
    @InjectRepository(ReportProject)
    private readonly projectsRepository: Repository<ReportProject>,
    @InjectRepository(ProjectReportEntry)
    private readonly projectReportEntriesRepository: Repository<ProjectReportEntry>,
    @InjectRepository(ProjectGanttStage)
    private readonly stagesRepository: Repository<ProjectGanttStage>,
    @InjectRepository(ProjectGanttEvent)
    private readonly eventsRepository: Repository<ProjectGanttEvent>,
  ) {}

  async findProjects(): Promise<ReportProject[]> {
    const projects = await this.projectsRepository.find({
      relations: { files: true },
      order: { id: 'DESC' },
    })

    if (!projects.length) {
      return projects
    }

    const projectIds = projects.map((project) => project.id)

    const reportEntries = await this.projectReportEntriesRepository.find({
      where: {
        projectId: In(projectIds),
      },
      select: {
        id: true,
        projectId: true,
        reportDate: true,
        createdAt: true,
        nextReportDate: true,
      },
      order: {
        reportDate: 'DESC',
        createdAt: 'DESC',
        id: 'DESC',
      },
    })

    const latestReportByProjectId = new Map<number, ProjectReportEntry>()

    reportEntries.forEach((reportEntry) => {
      if (!latestReportByProjectId.has(reportEntry.projectId)) {
        latestReportByProjectId.set(reportEntry.projectId, reportEntry)
      }
    })

    return projects.map((project) => ({
      ...project,
      nextProjectReportDate:
        latestReportByProjectId.get(project.id)?.nextReportDate ?? null,
    }))
  }

  async findProjectsPlan(query: ProjectReportsPlanQueryDto) {
    const projects = await this.projectsRepository.find({ order: { id: 'DESC' } })
    const projectIds = projects.map((project) => project.id)
    const stages = projectIds.length
      ? await this.stagesRepository.find({ where: { projectId: In(projectIds.map(String)), isGroup: false }, order: { sortOrder: 'ASC', id: 'ASC' } })
      : []
    const stageIds = stages.map((stage) => stage.id)
    const events = stageIds.length
      ? await this.eventsRepository.find({ where: { stageId: In(stageIds) }, order: { sortOrder: 'ASC', id: 'ASC' } })
      : []
    const eventsByStageId = new Map<number, ProjectGanttEvent[]>()
    const eventsByProjectId = new Map<string, ProjectGanttEvent[]>()
    for (const event of events) {
      const list = eventsByStageId.get(event.stageId) ?? []
      list.push(event)
      eventsByStageId.set(event.stageId, list)
      const projectEvents = eventsByProjectId.get(String(event.projectId)) ?? []
      projectEvents.push(event)
      eventsByProjectId.set(String(event.projectId), projectEvents)
    }
    const stagesByProjectId = new Map<string, ProjectGanttStage[]>()
    for (const stage of stages) {
      const list = stagesByProjectId.get(String(stage.projectId)) ?? []
      list.push(stage)
      stagesByProjectId.set(String(stage.projectId), list)
    }

    const search = query.search?.trim().toLowerCase()
    return projects.flatMap((project) => {
      if (query.status && project.projectStatus !== query.status) return []
      if (search && ![project.title, project.clientCompany, project.responsible].some((value) => value?.toLowerCase().includes(search))) return []
      const projectStages = (stagesByProjectId.get(String(project.id)) ?? []).sort((left, right) =>
        (left.parentStageId == null ? -1 : Number(left.parentStageId)) -
          (right.parentStageId == null ? -1 : Number(right.parentStageId)) ||
        left.sortOrder - right.sortOrder ||
        left.id - right.id,
      )
      const projectEvents = eventsByProjectId.get(String(project.id)) ?? []
      const planDates = projectEvents.flatMap((event) => [event.planStartDate, event.planEndDate].filter((date): date is string => Boolean(date)))
      const factDates = projectEvents.flatMap((event) => [event.factStartDate, event.factEndDate].filter((date): date is string => Boolean(date)))
      const planStartDate = planDates.length ? planDates.reduce((min, date) => date < min ? date : min) : null
      const planEndDate = planDates.length ? planDates.reduce((max, date) => date > max ? date : max) : null
      const factStartDate = factDates.length ? factDates.reduce((min, date) => date < min ? date : min) : null
      const factEndDate = factDates.length ? factDates.reduce((max, date) => date > max ? date : max) : null
      if ((query.from || query.to) && planDates.length === 0) return []
      if ((query.from && planEndDate && planEndDate < query.from) || (query.to && planStartDate && planStartDate > query.to)) return []
      return [{
        id: project.id,
        bitrixProjectId: project.bitrixProjectId,
        title: project.title,
        projectStatus: project.projectStatus,
        responsible: project.responsible,
        clientCompany: project.clientCompany,
        projectStartDate: project.projectStartDate,
        deadline: project.deadline,
        summaryPlanCompletionDate: project.summaryPlanCompletionDate,
        stages: projectStages.map((stage) => ({
          id: stage.id,
          title: stage.title,
          stageType: stage.stageType,
          parentStageId: stage.parentStageId,
          sortOrder: stage.sortOrder,
          events: (eventsByStageId.get(stage.id) ?? []).map((event) => ({
            id: event.id,
            title: event.title,
            planStartDate: event.planStartDate,
            planEndDate: event.planEndDate,
            factStartDate: event.factStartDate,
            factEndDate: event.factEndDate,
          })),
        })),
        planStartDate,
        planEndDate,
        factStartDate,
        factEndDate,
      }]
    })
  }

  createProject(dto: CreateReportProjectDto): Promise<ReportProject> {
    const project = this.projectsRepository.create({
      ...dto,
      title: dto.title.trim(),
    })

    return this.projectsRepository.save(project)
  }

  findProject(projectId: number): Promise<ReportProject> {
    return this.findProjectOrFail(projectId)
  }

  async updateProject(
    projectId: number,
    dto: UpdateReportProjectDto,
  ): Promise<ReportProject> {
    const project = await this.findProjectOrFail(projectId)

    Object.assign(project, dto)

    if (dto.title !== undefined) {
      project.title = dto.title.trim()
    }

    return this.projectsRepository.save(project)
  }

  async deleteProject(projectId: number): Promise<void> {
    const project = await this.findProjectOrFail(projectId)

    await Promise.all(
      project.files.map((file) => this.deletePhysicalFile(file.storagePath)),
    )
    await this.projectsRepository.remove(project)
  }

  private getAbsoluteStoragePath(storagePath: string): string {
    return join(process.cwd(), storagePath)
  }

  private async deletePhysicalFile(storagePath: string): Promise<void> {
    await rm(this.getAbsoluteStoragePath(storagePath), { force: true })
  }

  private async findProjectOrFail(projectId: number) {
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
      relations: { files: true },
    })

    if (!project) {
      throw new NotFoundException('Project not found')
    }

    return project
  }
}
