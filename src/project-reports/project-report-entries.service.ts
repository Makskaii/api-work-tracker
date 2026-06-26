import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateProjectReportEntryDto } from './dto/create-project-report-entry.dto'
import { UpdateProjectReportEntryDto } from './dto/update-project-report-entry.dto'
import { ProjectReportEntryFile } from './entities/project-report-entry-file.entity'
import {
  ProjectReportEntry,
  ProjectReportEntrySource,
} from './entities/project-report-entry.entity'
import { ReportProject } from './entities/project-report-project.entity'
import type { ReportProjectUploadedFile } from './project-reports.types'

@Injectable()
export class ProjectReportEntriesService {
  constructor(
    @InjectRepository(ReportProject)
    private readonly projectsRepository: Repository<ReportProject>,
    @InjectRepository(ProjectReportEntry)
    private readonly projectReportEntriesRepository: Repository<ProjectReportEntry>,
    @InjectRepository(ProjectReportEntryFile)
    private readonly projectReportEntryFilesRepository: Repository<ProjectReportEntryFile>,
  ) {}

  async findProjectReportEntries(projectId: number): Promise<ProjectReportEntry[]> {
    await this.findProjectOrFail(projectId)

    return this.projectReportEntriesRepository.find({
      where: { projectId },
      relations: { files: true },
      order: { reportDate: 'DESC', createdAt: 'DESC', id: 'DESC' },
    })
  }

  async createProjectReportEntry(
    projectId: number,
    dto: CreateProjectReportEntryDto,
  ): Promise<ProjectReportEntry> {
    const project = await this.findProjectOrFail(projectId)
    const text = dto.text.trim()
    const authorName = dto.authorName.trim()

    if (!text) {
      throw new BadRequestException('Текст отчёта обязателен')
    }

    if (!authorName) {
      throw new BadRequestException('Автор отчёта обязателен')
    }

    const reportEntry = this.projectReportEntriesRepository.create({
      projectId: project.id,
      project,
      authorId: dto.authorId?.trim() || null,
      authorName,
      text,
      reportDate: this.getCurrentDate(),
      nextReportDate: dto.nextReportDate ?? null,
      source: dto.source ?? ProjectReportEntrySource.ProjectReport,
      ganttStageId: dto.ganttStageId ?? null,
      ganttDate: dto.ganttDate ?? null,
    })

    return this.projectReportEntriesRepository.save(reportEntry)
  }

  async updateProjectReportEntry(
    projectId: number,
    reportId: number,
    dto: UpdateProjectReportEntryDto,
  ): Promise<ProjectReportEntry> {
    const reportEntry = await this.findReportEntryForProject(projectId, reportId)

    if (dto.authorName !== undefined) {
      const authorName = dto.authorName.trim()

      if (!authorName) {
        throw new BadRequestException('Автор отчёта обязателен')
      }

      reportEntry.authorName = authorName
    }

    if (dto.authorId !== undefined) {
      reportEntry.authorId = dto.authorId?.trim() || null
    }

    if (dto.text !== undefined) {
      const text = dto.text.trim()

      if (!text) {
        throw new BadRequestException('Текст отчёта обязателен')
      }

      reportEntry.text = text
    }

    if (dto.nextReportDate !== undefined) {
      reportEntry.nextReportDate = dto.nextReportDate ?? null
    }

    if (dto.source !== undefined) {
      reportEntry.source = dto.source
    }

    if (dto.ganttStageId !== undefined) {
      reportEntry.ganttStageId = dto.ganttStageId ?? null
    }

    if (dto.ganttDate !== undefined) {
      reportEntry.ganttDate = dto.ganttDate ?? null
    }

    await this.projectReportEntriesRepository.save(reportEntry)

    return this.findReportEntryForProject(projectId, reportId)
  }

  async deleteProjectReportEntry(
    projectId: number,
    reportId: number,
  ): Promise<void> {
    const reportEntry = await this.findReportEntryForProject(projectId, reportId)

    await Promise.all(
      reportEntry.files.map((file) => this.deletePhysicalFile(file.path)),
    )
    await this.projectReportEntriesRepository.remove(reportEntry)
  }

  async addProjectReportEntryFile(
    projectId: number,
    reportId: number,
    file: ReportProjectUploadedFile | undefined,
  ): Promise<ProjectReportEntryFile> {
    const reportEntry = await this.findReportEntryForProject(projectId, reportId)

    if (!file?.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const { path, storedName } = await this.saveReportEntryFile(reportId, file)
    const reportEntryFile = this.projectReportEntryFilesRepository.create({
      reportEntryId: reportEntry.id,
      reportEntry,
      originalName: this.normalizeUploadedFileName(file.originalname),
      storedName,
      mimeType: file.mimetype,
      size: file.size,
      path,
    })

    return this.projectReportEntryFilesRepository.save(reportEntryFile)
  }

  async getProjectReportEntryFile(
    projectId: number,
    reportId: number,
    fileId: number,
  ): Promise<{
    file: ProjectReportEntryFile
    stream: ReturnType<typeof createReadStream>
  }> {
    const file = await this.findReportEntryFileForProject(
      projectId,
      reportId,
      fileId,
    )
    const absolutePath = this.getAbsoluteStoragePath(file.path)

    try {
      const fileStat = await stat(absolutePath)

      if (!fileStat.isFile()) {
        throw new Error('Storage path is not a file')
      }

      await access(absolutePath)
    } catch {
      throw new NotFoundException('Report file not found on disk')
    }

    return {
      file,
      stream: createReadStream(absolutePath),
    }
  }

  async deleteProjectReportEntryFile(
    projectId: number,
    reportId: number,
    fileId: number,
  ): Promise<void> {
    const file = await this.findReportEntryFileForProject(
      projectId,
      reportId,
      fileId,
    )

    await this.deletePhysicalFile(file.path)
    await this.projectReportEntryFilesRepository.remove(file)
  }

  private async saveReportEntryFile(
    reportId: number,
    file: ReportProjectUploadedFile,
  ): Promise<{ path: string; storedName: string }> {
    if (!file.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const storedName = `${Date.now()}-${randomUUID()}-${this.sanitizeFileName(
      file.originalname,
    )}`
    const path = posix.join(
      'uploads',
      'project-report-entries',
      String(reportId),
      storedName,
    )
    const uploadDir = join(
      process.cwd(),
      'uploads',
      'project-report-entries',
      String(reportId),
    )

    await mkdir(uploadDir, { recursive: true })
    await writeFile(join(uploadDir, storedName), file.buffer)

    return { path, storedName }
  }

  private normalizeUploadedFileName(originalName: string): string {
    try {
      const decoded = Buffer.from(originalName, 'latin1').toString('utf8')

      if (decoded && !decoded.includes('\uFFFD')) {
        return decoded
      }

      return originalName
    } catch {
      return originalName
    }
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Z\u0400-\u04FF0-9._ -]/g, '_')
  }

  private getAbsoluteStoragePath(storagePath: string): string {
    return join(process.cwd(), storagePath)
  }

  private async deletePhysicalFile(storagePath: string): Promise<void> {
    await rm(this.getAbsoluteStoragePath(storagePath), { force: true })
  }

  private getCurrentDate(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private async findReportEntryForProject(projectId: number, reportId: number) {
    const reportEntry = await this.projectReportEntriesRepository.findOne({
      where: {
        id: reportId,
        projectId,
      },
      relations: { files: true },
    })

    if (!reportEntry) {
      throw new NotFoundException('Project report not found')
    }

    return reportEntry
  }

  private async findReportEntryFileForProject(
    projectId: number,
    reportId: number,
    fileId: number,
  ) {
    const file = await this.projectReportEntryFilesRepository.findOne({
      where: {
        id: fileId,
        reportEntryId: reportId,
        reportEntry: {
          id: reportId,
          projectId,
        },
      },
      relations: { reportEntry: true },
    })

    if (!file) {
      throw new NotFoundException('Project report file not found')
    }

    return file
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
