import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { createReadStream } from 'fs'
import { access, mkdir, rm, stat, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { join, posix } from 'path'
import { Repository } from 'typeorm'
import { CreateGanttEventDto } from './dto/create-gantt-event.dto'
import { CreateGanttIncidentDto } from './dto/create-gantt-incident.dto'
import { UpdateGanttEventDto } from './dto/update-gantt-event.dto'
import { UpdateGanttIncidentDto } from './dto/update-gantt-incident.dto'
import {
  GanttCustomEvent,
  GanttCustomEventKind,
} from './entities/gantt-custom-event.entity'
import { GanttIncidentFile } from './entities/gantt-incident-file.entity'
import {
  GanttIncident,
  GanttIncidentEntityType,
} from './entities/gantt-incident.entity'

export type GanttUploadedFile = {
  originalname: string
  mimetype: string
  size: number
  buffer?: Buffer
}

@Injectable()
export class GanttService {
  constructor(
    @InjectRepository(GanttCustomEvent)
    private readonly customEventsRepository: Repository<GanttCustomEvent>,
    @InjectRepository(GanttIncident)
    private readonly incidentsRepository: Repository<GanttIncident>,
    @InjectRepository(GanttIncidentFile)
    private readonly incidentFilesRepository: Repository<GanttIncidentFile>,
  ) {}

  findProjectEvents(projectId: string): Promise<GanttCustomEvent[]> {
    return this.customEventsRepository.find({
      where: { bitrixProjectId: this.normalizeRequiredString(projectId, 'projectId') },
      order: {
        sortOrder: 'ASC',
        id: 'ASC',
      },
    })
  }

  async createProjectEvent(
    projectId: string,
    dto: CreateGanttEventDto,
  ): Promise<GanttCustomEvent> {
    const event = this.customEventsRepository.create({
      bitrixProjectId: this.normalizeRequiredString(projectId, 'projectId'),
      title: this.normalizeRequiredString(dto.title, 'title'),
      eventKind: this.normalizeEventKind(dto.eventKind),
      planStartDate: this.normalizeDate(dto.planStartDate, 'planStartDate'),
      planEndDate: this.normalizeDate(dto.planEndDate, 'planEndDate'),
      factStartDate: this.normalizeDate(dto.factStartDate, 'factStartDate'),
      factEndDate: this.normalizeDate(dto.factEndDate, 'factEndDate'),
      sortOrder: this.normalizeSortOrder(dto.sortOrder),
    })

    this.validateEventDates(event)

    return this.customEventsRepository.save(event)
  }

  async updateEvent(
    eventId: number,
    dto: UpdateGanttEventDto,
  ): Promise<GanttCustomEvent> {
    const event = await this.getEventOrFail(eventId)

    if (dto.title !== undefined) {
      event.title = this.normalizeRequiredString(dto.title, 'title')
    }

    if (dto.eventKind !== undefined) {
      event.eventKind = this.normalizeEventKind(dto.eventKind)
    }

    if (dto.planStartDate !== undefined) {
      event.planStartDate = this.normalizeDate(dto.planStartDate, 'planStartDate')
    }

    if (dto.planEndDate !== undefined) {
      event.planEndDate = this.normalizeDate(dto.planEndDate, 'planEndDate')
    }

    if (dto.factStartDate !== undefined) {
      event.factStartDate = this.normalizeDate(dto.factStartDate, 'factStartDate')
    }

    if (dto.factEndDate !== undefined) {
      event.factEndDate = this.normalizeDate(dto.factEndDate, 'factEndDate')
    }

    if (dto.sortOrder !== undefined) {
      event.sortOrder = this.normalizeSortOrder(dto.sortOrder)
    }

    this.validateEventDates(event)

    return this.customEventsRepository.save(event)
  }

  async deleteEvent(eventId: number): Promise<void> {
    const event = await this.getEventOrFail(eventId)

    await this.customEventsRepository.remove(event)
  }

  findProjectIncidents(projectId: string): Promise<GanttIncident[]> {
    return this.incidentsRepository.find({
      where: { bitrixProjectId: this.normalizeRequiredString(projectId, 'projectId') },
      relations: {
        files: true,
      },
      order: {
        incidentDate: 'DESC',
        id: 'DESC',
      },
    })
  }

  async createProjectIncident(
    projectId: string,
    dto: CreateGanttIncidentDto,
  ): Promise<GanttIncident> {
    const incident = this.incidentsRepository.create({
      bitrixProjectId: this.normalizeRequiredString(projectId, 'projectId'),
      entityType: this.normalizeIncidentEntityType(dto.entityType),
      entityId: this.normalizeRequiredString(dto.entityId, 'entityId'),
      title: this.normalizeIncidentTitle(dto.title),
      description: this.normalizeOptionalString(dto.description),
      incidentDate: this.normalizeRequiredDate(dto.incidentDate, 'incidentDate'),
    })

    const savedIncident = await this.incidentsRepository.save(incident)

    return this.getIncidentOrFail(savedIncident.id)
  }

  async updateIncident(
    incidentId: number,
    dto: UpdateGanttIncidentDto,
  ): Promise<GanttIncident> {
    const incident = await this.getIncidentOrFail(incidentId)

    if (dto.entityType !== undefined) {
      incident.entityType = this.normalizeIncidentEntityType(dto.entityType)
    }

    if (dto.entityId !== undefined) {
      incident.entityId = this.normalizeRequiredString(dto.entityId, 'entityId')
    }

    if (dto.title !== undefined) {
      incident.title = this.normalizeIncidentTitle(dto.title)
    }

    if (dto.description !== undefined) {
      incident.description = this.normalizeOptionalString(dto.description)
    }

    if (dto.incidentDate !== undefined) {
      incident.incidentDate = this.normalizeRequiredDate(
        dto.incidentDate,
        'incidentDate',
      )
    }

    const savedIncident = await this.incidentsRepository.save(incident)

    return this.getIncidentOrFail(savedIncident.id)
  }

  async deleteIncident(incidentId: number): Promise<void> {
    const incident = await this.getIncidentOrFail(incidentId)

    await Promise.all(
      incident.files.map((file) => this.deletePhysicalFile(file.storagePath)),
    )
    await this.incidentsRepository.remove(incident)
  }

  async addIncidentFiles(
    incidentId: number,
    files: GanttUploadedFile[],
  ): Promise<GanttIncidentFile[]> {
    const incident = await this.getIncidentOrFail(incidentId)

    if (!files.length) {
      throw new BadRequestException('No files provided')
    }

    const savedFiles: GanttIncidentFile[] = []

    for (const file of files) {
      if (!file.buffer) {
        throw new BadRequestException('Invalid uploaded file')
      }

      const storagePath = await this.saveIncidentFile(incident.id, file)
      const incidentFile = this.incidentFilesRepository.create({
        incidentId: incident.id,
        incident,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath,
      })

      savedFiles.push(await this.incidentFilesRepository.save(incidentFile))
    }

    return savedFiles
  }

  async getIncidentFile(
    incidentId: number,
    fileId: number,
  ): Promise<{ file: GanttIncidentFile; stream: ReturnType<typeof createReadStream> }> {
    const file = await this.incidentFilesRepository.findOne({
      where: {
        id: fileId,
        incidentId,
      },
    })

    if (!file) {
      throw new NotFoundException('Incident file not found')
    }

    const absolutePath = this.getAbsoluteStoragePath(file.storagePath)

    try {
      const fileStat = await stat(absolutePath)

      if (!fileStat.isFile()) {
        throw new Error('Storage path is not a file')
      }

      await access(absolutePath)
    } catch {
      throw new NotFoundException('Incident file not found on disk')
    }

    return {
      file,
      stream: createReadStream(absolutePath),
    }
  }

  async deleteIncidentFile(incidentId: number, fileId: number): Promise<void> {
    const file = await this.incidentFilesRepository.findOne({
      where: {
        id: fileId,
        incidentId,
      },
    })

    if (!file) {
      throw new NotFoundException('Incident file not found')
    }

    await this.deletePhysicalFile(file.storagePath)
    await this.incidentFilesRepository.remove(file)
  }

  private async getEventOrFail(eventId: number): Promise<GanttCustomEvent> {
    const event = await this.customEventsRepository.findOne({
      where: { id: eventId },
    })

    if (!event) {
      throw new NotFoundException('Gantt event not found')
    }

    return event
  }

  private async getIncidentOrFail(incidentId: number): Promise<GanttIncident> {
    const incident = await this.incidentsRepository.findOne({
      where: { id: incidentId },
      relations: {
        files: true,
      },
    })

    if (!incident) {
      throw new NotFoundException('Gantt incident not found')
    }

    return incident
  }

  private validateEventDates(event: GanttCustomEvent): void {
    if (event.eventKind === GanttCustomEventKind.Duration) {
      if (!event.planStartDate || !event.planEndDate) {
        throw new BadRequestException(
          'Duration event requires planStartDate and planEndDate',
        )
      }

      this.validateDateOrder(
        event.planStartDate,
        event.planEndDate,
        'planStartDate',
        'planEndDate',
      )
    } else if (!event.planStartDate && !event.factStartDate) {
      throw new BadRequestException(
        'One-time event requires planStartDate or factStartDate',
      )
    }

    if (event.factStartDate && event.factEndDate) {
      this.validateDateOrder(
        event.factStartDate,
        event.factEndDate,
        'factStartDate',
        'factEndDate',
      )
    }
  }

  private validateDateOrder(
    startDate: string,
    endDate: string,
    startFieldName: string,
    endFieldName: string,
  ): void {
    if (Date.parse(startDate) > Date.parse(endDate)) {
      throw new BadRequestException(
        `${startFieldName} must be earlier than or equal to ${endFieldName}`,
      )
    }
  }

  private normalizeEventKind(value: string): GanttCustomEventKind {
    if (
      value === GanttCustomEventKind.OneTime ||
      value === GanttCustomEventKind.Duration
    ) {
      return value
    }

    throw new BadRequestException('Invalid eventKind')
  }

  private normalizeIncidentEntityType(value: string): GanttIncidentEntityType {
    if (
      value === GanttIncidentEntityType.BitrixStage ||
      value === GanttIncidentEntityType.CustomEvent ||
      value === GanttIncidentEntityType.PaymentWaitingOverdue
    ) {
      return value
    }

    throw new BadRequestException('Invalid entityType')
  }

  private normalizeRequiredString(value: unknown, fieldName: string): string {
    const normalizedValue = String(value ?? '').trim()

    if (!normalizedValue) {
      throw new BadRequestException(`${fieldName} is required`)
    }

    return normalizedValue
  }

  private normalizeOptionalString(value: unknown): string | null {
    const normalizedValue = String(value ?? '').trim()

    return normalizedValue || null
  }

  private normalizeIncidentTitle(value: unknown): string {
    return this.normalizeOptionalString(value) ?? 'Инцидент'
  }

  private normalizeDate(
    value: string | null | undefined,
    fieldName: string,
  ): string | null {
    if (value === null || value === undefined || value === '') {
      return null
    }

    return this.normalizeRequiredDate(value, fieldName)
  }

  private normalizeRequiredDate(value: string, fieldName: string): string {
    const normalizedValue = this.normalizeRequiredString(value, fieldName)

    if (Number.isNaN(Date.parse(normalizedValue))) {
      throw new BadRequestException(`${fieldName} must be a valid date`)
    }

    return normalizedValue
  }

  private normalizeSortOrder(value: number | null | undefined): number {
    if (value === null || value === undefined) {
      return 0
    }

    const normalizedValue = Number(value)

    if (!Number.isFinite(normalizedValue)) {
      throw new BadRequestException('sortOrder must be a number')
    }

    return normalizedValue
  }

  private async saveIncidentFile(
    incidentId: number,
    file: GanttUploadedFile,
  ): Promise<string> {
    const buffer = file.buffer

    if (!buffer) {
      throw new BadRequestException('Invalid uploaded file')
    }
    const fileName = `${Date.now()}-${randomUUID()}-${this.sanitizeFileName(
      file.originalname,
    )}`
    const relativePath = posix.join(
      'uploads',
      'gantt-incidents',
      String(incidentId),
      fileName,
    )
    const absolutePath = this.getAbsoluteStoragePath(relativePath)

    await mkdir(join(absolutePath, '..'), { recursive: true })
    await writeFile(absolutePath, buffer)

    return relativePath
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
}


