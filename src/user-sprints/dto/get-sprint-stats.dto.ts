import { Type } from 'class-transformer'
import { IsArray, IsDateString, ArrayNotEmpty, IsInt } from 'class-validator'

export class GetSprintStatsDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  userIds: number[]

  @IsDateString()
  startDate: string

  @IsDateString()
  endDate: string
}
