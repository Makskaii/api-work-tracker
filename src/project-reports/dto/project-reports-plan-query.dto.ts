import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator'
import { ReportProjectStatus } from '../entities/project-report-project.entity'

export class ProjectReportsPlanQueryDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsEnum(ReportProjectStatus)
  status?: ReportProjectStatus

  @IsOptional()
  @IsDateString()
  from?: string

  @IsOptional()
  @IsDateString()
  to?: string
}
