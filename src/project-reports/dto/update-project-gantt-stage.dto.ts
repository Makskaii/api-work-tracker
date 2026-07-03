import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'
import {
  ProjectGanttDependencyAnchor,
  ProjectGanttStageType,
} from '../entities/project-gantt-stage.entity'

export class UpdateProjectGanttStageDto {
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
  dependsOnStageId?: number | null

  @IsOptional()
  @IsEnum(ProjectGanttDependencyAnchor)
  dependencyAnchor?: ProjectGanttDependencyAnchor | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number
}
