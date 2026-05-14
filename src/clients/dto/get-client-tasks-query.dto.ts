import { IsDateString, IsOptional } from 'class-validator'

export class GetClientTasksQueryDto {
  @IsOptional()
  @IsDateString()
  createdFrom?: string

  @IsOptional()
  @IsDateString()
  start?: string

  @IsOptional()
  @IsDateString()
  end?: string
}
