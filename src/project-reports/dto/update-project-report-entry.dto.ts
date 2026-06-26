import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator'
import { ProjectReportEntrySource } from '../entities/project-report-entry.entity'

export class UpdateProjectReportEntryDto {
  @IsOptional()
  @IsString()
  authorName?: string

  @IsOptional()
  @IsString()
  authorId?: string | null

  @IsOptional()
  @IsString()
  text?: string

  @IsOptional()
  @IsDateString()
  nextReportDate?: string | null

  @IsOptional()
  @IsEnum(ProjectReportEntrySource)
  source?: ProjectReportEntrySource

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ganttStageId?: number | null

  @IsOptional()
  @IsDateString()
  ganttDate?: string | null
}
