import { Type } from 'class-transformer'
import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator'
import {
  ProjectGanttDependencyAnchor,
  ProjectGanttGroupStatus,
  ProjectGanttStageType,
} from '../entities/project-gantt-stage.entity'

export class UpdateProjectGanttStageDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false })
  @Min(0)
  @Max(1000000)
  plannedHours?: number | null

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(ProjectGanttGroupStatus)
  groupStatus?: ProjectGanttGroupStatus

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
