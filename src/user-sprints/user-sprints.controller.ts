import { Body, Controller, Post } from '@nestjs/common'
import { GetSprintStatsDto } from './dto/get-sprint-stats.dto'
import { UserSprintsService } from './user-sprints.service'

@Controller('user-sprints')
export class UserSprintsController {
  constructor(private readonly userSprintsService: UserSprintsService) {}

  @Post('stats')
  getStats(@Body() dto: GetSprintStatsDto) {
    return this.userSprintsService.getSprintStatistics(
      dto.userIds,
      dto.startDate,
      dto.endDate,
    )
  }
}
