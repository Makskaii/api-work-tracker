import { Controller, Get, Post, Query } from '@nestjs/common'
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
  async getCurrentSprintDeveloperStats(
    @Query('departmentIds') departmentIds?: string,
  ) {
    const parsedDepartmentIds = departmentIds
      ? departmentIds
          .split(',')
          .map((item) => Number(item.trim()))
          .filter((item) => !Number.isNaN(item))
      : undefined

    return await this.sprintsService.getCurrentSprintEmployeeStats(
      parsedDepartmentIds,
    )
  }
}
