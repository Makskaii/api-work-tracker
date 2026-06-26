import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator'
import { ProjectGanttStageType } from '../entities/project-gantt-stage.entity'

export class CreateProjectGanttStageDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  code?: string

  @IsOptional()
  @IsEnum(ProjectGanttStageType)
  stageType?: ProjectGanttStageType | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number
}
