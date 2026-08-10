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
import { ReportProject } from './entities/project-report-project.entity'
import {
  ReportProjectFile,
  ReportProjectFileKind,
} from './entities/report-project-file.entity'
import type { ReportProjectUploadedFile } from './project-reports.types'

@Injectable()
export class ProjectReportFilesService {
  constructor(
    @InjectRepository(ReportProject)
    private readonly projectsRepository: Repository<ReportProject>,
    @InjectRepository(ReportProjectFile)
    private readonly projectFilesRepository: Repository<ReportProjectFile>,
  ) {}

  async addProjectFile(
    projectId: number,
    fileKind: ReportProjectFileKind,
    file: ReportProjectUploadedFile | undefined,
  ): Promise<ReportProjectFile> {
    if (!Object.values(ReportProjectFileKind).includes(fileKind)) {
      throw new BadRequestException('Invalid project file kind')
    }

    const project = await this.findProjectOrFail(projectId)

    if (!file?.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const storagePath = await this.saveProjectFile(project.id, fileKind, file)
    const projectFile = this.projectFilesRepository.create({
      projectId: project.id,
      project,
      fileKind,
      originalName: this.normalizeUploadedFileName(file.originalname),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      storagePath,
    })

    return this.projectFilesRepository.save(projectFile)
  }

  async getProjectFile(
    projectId: number,
    fileId: number,
  ): Promise<{
    file: ReportProjectFile
    stream: ReturnType<typeof createReadStream>
  }> {
    const file = await this.projectFilesRepository.findOne({
      where: {
        id: fileId,
        projectId,
      },
    })

    if (!file) {
      throw new NotFoundException('Project file not found')
    }

    const absolutePath = this.getAbsoluteStoragePath(file.storagePath)

    try {
      const fileStat = await stat(absolutePath)

      if (!fileStat.isFile()) {
        throw new Error('Storage path is not a file')
      }

      await access(absolutePath)
    } catch {
      throw new NotFoundException('Project file not found on disk')
    }

    return {
      file,
      stream: createReadStream(absolutePath),
    }
  }

  async deleteProjectFile(projectId: number, fileId: number): Promise<void> {
    const file = await this.projectFilesRepository.findOne({
      where: {
        id: fileId,
        projectId,
      },
    })

    if (!file) {
      throw new NotFoundException('Project file not found')
    }

    await this.deletePhysicalFile(file.storagePath)
    await this.projectFilesRepository.remove(file)
  }

  private async saveProjectFile(
    projectId: number,
    fileKind: ReportProjectFileKind,
    file: ReportProjectUploadedFile,
  ): Promise<string> {
    if (!file.buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }

    const fileName = `${Date.now()}-${randomUUID()}-${this.sanitizeFileName(
      file.originalname,
    )}`
    const relativePath = posix.join(
      'uploads',
      'report-projects',
      String(projectId),
      fileKind,
      fileName,
    )
    const uploadDir = join(
      process.cwd(),
      'uploads',
      'report-projects',
      String(projectId),
      fileKind,
    )

    await mkdir(uploadDir, { recursive: true })
    await writeFile(join(uploadDir, fileName), file.buffer)

    return relativePath
  }

  private normalizeUploadedFileName(originalName: string): string {
    try {
      const decoded = Buffer.from(originalName, 'latin1').toString('utf8')

      if (decoded && !decoded.includes('�')) {
        return decoded
      }

      return originalName
    } catch {
      return originalName
    }
  }

  private sanitizeFileName(fileName: string): string {
    return fileName.replace(/[^a-zA-Zа-яА-ЯёЁ0-9._ -]/g, '_')
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
