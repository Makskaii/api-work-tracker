import { Controller, Get, Post } from '@nestjs/common'
import { SprintsService } from './sprints.service'

@Controller('sprints')
export class SprintsController {
  constructor(private readonly sprintsService: SprintsService) {}

  @Post('sync')
  async syncTasks() {
    return await this.sprintsService.syncTasks()
  }

  @Get('current/tasks')
  async getCurrentSprintTasks() {
    return await this.sprintsService.getCurrentSprintTasks()
  }

  @Get('current/developers/stats')
  async getCurrentSprintDeveloperStats() {
    return await this.sprintsService.getCurrentSprintDeveloperStats()
  }
}
