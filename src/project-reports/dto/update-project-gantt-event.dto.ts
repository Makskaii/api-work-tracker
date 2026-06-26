import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator'
import { ProjectGanttEventKind } from '../entities/project-gantt-event.entity'

export class UpdateProjectGanttEventDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stageId?: number

  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsEnum(ProjectGanttEventKind)
  eventKind?: ProjectGanttEventKind

  @IsOptional()
  @IsDateString()
  planStartDate?: string | null

  @IsOptional()
  @IsDateString()
  planEndDate?: string | null

  @IsOptional()
  @IsDateString()
  factStartDate?: string | null

  @IsOptional()
  @IsDateString()
  factEndDate?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number | null
}
