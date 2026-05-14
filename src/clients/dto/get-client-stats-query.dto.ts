import { IsDateString } from 'class-validator'

export class GetClientStatsQueryDto {
  @IsDateString()
  start!: string

  @IsDateString()
  end!: string
}
