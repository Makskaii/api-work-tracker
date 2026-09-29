import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DataSource, Repository } from 'typeorm'
import type { CreateSupportReportVersionDto } from './dto/create-support-report-version.dto'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReportVersion } from './entities/support-hours-report-version.entity'
import { SupportHoursPackageReportService } from './support-hours-package-report.service'

export type SupportReportVersionView = {
  id: number
  packageId: number
  projectId: number
  projectTitle: string
  clientName: string | null
  versionNumber: number
  createdAt: Date
  filename: string
  byteSize: number
  sha256: string
  purchasedHours: number
  spentHours: number
  remainingHours: number
}

@Injectable()
export class SupportHoursReportVersionsService {
  private readonly logger = new Logger(SupportHoursReportVersionsService.name)
  private readonly directory: string
  private readonly pending = new Map<string, Promise<SupportReportVersionView>>()

  constructor(
    @InjectRepository(SupportHoursReportVersion)
    private readonly versions: Repository<SupportHoursReportVersion>,
    private readonly dataSource: DataSource,
    private readonly reports: SupportHoursPackageReportService,
    config: ConfigService,
  ) {
    this.directory = resolve(config.get<string>('SUPPORT_REPORT_VERSIONS_DIR') || join(process.cwd(), 'uploads', 'support-report-versions'))
  }

  async create(packageId: number, dto: CreateSupportReportVersionDto): Promise<SupportReportVersionView> {
    const key = `${packageId}:${dto.requestId}`
    const running = this.pending.get(key)
    if (running) return running
    const promise = this.createVersion(packageId, dto.requestId)
    this.pending.set(key, promise)
    try {
      return await promise
    } finally {
      this.pending.delete(key)
    }
  }

  async list(projectId: number, packageId?: number): Promise<SupportReportVersionView[]> {
    const rows = await this.versions.find({
      where: { projectId, ...(packageId === undefined ? {} : { packageId }) },
      order: { createdAt: 'DESC', id: 'DESC' },
    })
    return rows.map((row) => this.view(row))
  }

  async download(id: number): Promise<{ buffer: Buffer; filename: string }> {
    const row = await this.versions.findOne({ where: { id } })
    if (!row) throw new NotFoundException('Сохранённая версия отчёта не найдена')
    let buffer: Buffer
    try {
      buffer = await readFile(this.storagePath(row.storageFilename))
    } catch {
      throw new ServiceUnavailableException('Файл сохранённой версии недоступен. Обратитесь к администратору для восстановления из резервной копии')
    }
    if (buffer.byteLength !== Number(row.byteSize) || this.hash(buffer) !== row.sha256) {
      throw new ServiceUnavailableException('Файл сохранённой версии повреждён. Требуется восстановление из резервной копии')
    }
    return { buffer, filename: row.filename }
  }

  private async createVersion(packageId: number, requestId: string): Promise<SupportReportVersionView> {
    const existing = await this.versions.findOne({ where: { requestId } })
    if (existing) return this.existingView(existing, packageId)

    // Metadata is returned from the very snapshot used to render these bytes.
    const generated = await this.reports.generate(packageId)
    const { buffer, snapshot } = generated
    if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString() !== '%PDF-') {
      throw new ServiceUnavailableException('Не удалось подготовить PDF для сохранения')
    }
    const storageFilename = `${randomUUID()}.pdf`
    await this.writeAtomically(storageFilename, buffer)
    try {
      const row = await this.dataSource.transaction(async (manager) => {
        // A database row lock serializes numbering across backend instances and
        // prevents package removal while its document metadata is being saved.
        const currentPackage = await manager.getRepository(SupportHoursPackage).findOne({
          where: { id: packageId }, lock: { mode: 'pessimistic_write' },
        })
        if (!currentPackage) throw new NotFoundException('Пакет удалён. Обновите список пакетов')
        const repository = manager.getRepository(SupportHoursReportVersion)
        const repeated = await repository.findOne({ where: { requestId } })
        if (repeated) {
          this.existingView(repeated, packageId)
          return repeated
        }
        const last = await repository.findOne({ where: { packageId }, order: { versionNumber: 'DESC' } })
        const versionNumber = Number(last?.versionNumber ?? 0) + 1
        return repository.save(repository.create({
          requestId, packageId, versionNumber,
          // MySQL's session clock can differ from the Node connection timezone.
          // Persist the actual instant explicitly instead of its local NOW().
          createdAt: new Date(),
          projectId: snapshot.projectId,
          projectTitle: snapshot.projectTitle,
          clientName: snapshot.clientName,
          purchasedHours: snapshot.purchasedHours,
          spentHours: snapshot.spentHours,
          remainingHours: snapshot.remainingHours,
          storageFilename, byteSize: buffer.byteLength, sha256: this.hash(buffer),
          filename: `support-package-${packageId}-v${versionNumber}.pdf`,
        }))
      })
      if (row.storageFilename !== storageFilename) await this.removeUnusedFile(storageFilename)
      return this.view(row)
    } catch (error) {
      // A lost connection at COMMIT does not prove the insert failed. Verify
      // persistence before cleanup; retaining an orphan is safer than deleting
      // an issued document when the database itself is unavailable.
      let persisted: SupportHoursReportVersion | null
      try {
        persisted = await this.versions.findOne({ where: { requestId } })
      } catch {
        this.logger.warn('Could not confirm PDF version persistence; kept its file for recovery')
        throw error
      }
      if (persisted?.storageFilename !== storageFilename) await this.removeUnusedFile(storageFilename)
      if (persisted) return this.existingView(persisted, packageId)
      throw error
    }
  }

  private async writeAtomically(filename: string, buffer: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const destination = this.storagePath(filename)
    const temporary = `${destination}.tmp`
    try {
      const file = await open(temporary, 'wx', 0o600)
      try {
        await file.writeFile(buffer)
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporary, destination)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => this.logger.warn('Could not remove incomplete PDF version file'))
      throw error
    }
  }

  private storagePath(filename: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(filename)) {
      throw new ServiceUnavailableException('Некорректный путь сохранённой версии')
    }
    return join(this.directory, filename)
  }

  private async removeUnusedFile(filename: string): Promise<void> {
    await rm(this.storagePath(filename), { force: true }).catch(() => this.logger.warn('Could not remove unused PDF version file'))
  }

  private hash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex')
  }

  private existingView(row: SupportHoursReportVersion, packageId: number): SupportReportVersionView {
    if (Number(row.packageId) !== packageId) throw new ConflictException('Этот запрос уже использован для другого пакета')
    return this.view(row)
  }

  private view(row: SupportHoursReportVersion): SupportReportVersionView {
    return {
      id: Number(row.id), packageId: Number(row.packageId), projectId: Number(row.projectId),
      projectTitle: row.projectTitle, clientName: row.clientName,
      versionNumber: Number(row.versionNumber), createdAt: row.createdAt, filename: row.filename,
      byteSize: Number(row.byteSize), sha256: row.sha256,
      purchasedHours: Number(row.purchasedHours), spentHours: Number(row.spentHours),
      remainingHours: Number(row.remainingHours),
    }
  }
}
