import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { StorageCleanupService } from './storage-cleanup.service'

@Injectable()
export class StorageCronService {
  private readonly logger = new Logger(StorageCronService.name)

  constructor(private readonly cleanupService: StorageCleanupService) {}

  @Cron('0 3 * * 0')
  async handleCron() {
    this.logger.log('Starting scheduled storage cleanup...')
    try {
      await this.cleanupService.runCleanup()
    } catch (error) {
      this.logger.error('Scheduled cleanup failed', error)
    }
  }
}
