import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SupportHoursPackagesService } from './support-hours-packages.service'

@Injectable()
export class SupportHoursPackagesScheduler {
  private readonly logger = new Logger(SupportHoursPackagesScheduler.name)

  constructor(private readonly service: SupportHoursPackagesService) {}

  @Cron('0 21 * * *')
  async sync() {
    try {
      await this.service.sync()
    } catch (error) {
      this.logger.error('Support hours synchronization failed', error)
    }
  }
}
