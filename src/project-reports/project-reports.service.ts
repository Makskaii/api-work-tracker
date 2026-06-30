import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateReportProjectDto } from './dto/create-project-report-project.dto'
import { UpdateReportProjectDto } from './dto/update-project-report-project.dto'
import { ReportProject } from './entities/project-report-project.entity'

@Injectable()
export class ProjectReportsService {
  constructor(
    @InjectRepository(ReportProject)
    private readonly projectsRepository: Repository<ReportProject>,
  ) {}

  findProjects(): Promise<ReportProject[]> {
    return this.projectsRepository.find({
      relations: { files: true },
      order: { id: 'DESC' },
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
