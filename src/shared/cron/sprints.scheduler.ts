import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { SprintsService } from '../../sprints/sprints.service'

@Injectable()
export class SprintsScheduler {
  private readonly logger = new Logger(SprintsScheduler.name)
  private isRunning = false

  constructor(private readonly sprintsService: SprintsService) {}

  @Interval(90 * 60 * 1000)
  async handleSprintSync() {
    if (this.isRunning) {
      this.logger.warn('Sprint sync is already running, skipping this interval')
      return
    }

    this.isRunning = true
    this.logger.log('Starting scheduled sprint sync')

    try {
      const result = await this.sprintsService.syncTasks()
      this.logger.log(
        `Scheduled sprint sync finished: ${JSON.stringify(result)}`,
      )
    } catch (error) {
      this.logger.error(
        `Scheduled sprint sync failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      )
    } finally {
      this.isRunning = false
    }
  }
}
