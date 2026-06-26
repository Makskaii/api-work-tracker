import { Type } from 'class-transformer'
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator'
import { ProjectReportEntrySource } from '../entities/project-report-entry.entity'

export class CreateProjectReportEntryDto {
  @IsString()
  @IsNotEmpty()
  authorName!: string

  @IsOptional()
  @IsString()
  authorId?: string | null

  @IsString()
  @IsNotEmpty()
  text!: string

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
