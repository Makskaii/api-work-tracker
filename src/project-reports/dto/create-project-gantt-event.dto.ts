import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator'
import { ProjectGanttEventKind } from '../entities/project-gantt-event.entity'

export class CreateProjectGanttEventDto {
  @Type(() => Number)
  @IsInt()
  stageId!: number

  @IsString()
  title!: string

  @IsEnum(ProjectGanttEventKind)
  eventKind!: ProjectGanttEventKind

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
