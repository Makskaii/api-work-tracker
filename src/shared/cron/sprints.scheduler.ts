import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SprintsService } from 'src/sprints/sprints.service'

@Injectable()
export class SprintsScheduler {
  private readonly logger = new Logger(SprintsScheduler.name)

  constructor(private readonly sprintsService: SprintsService) {}

  @Cron('*/30 * * * *')
  async handleSprintSync() {
    this.logger.log('Starting scheduled sprint sync')

    try {
      const result = await this.sprintsService.syncTasks()
      this.logger.log(
        `Scheduled sprint sync finished: ${JSON.stringify(result)}`,
      )
    } catch (error) {
      this.logger.error(
        `Scheduled sprint sync failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    }
  }
}
