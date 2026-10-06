import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator'
import {
  ReportProjectStatus,
  ReportProjectType,
} from '../entities/project-report-project.entity'

export class CreateReportProjectDto {
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/)
  clientCompanyId?: string | null

  @IsOptional()
  @IsUUID()
  creationRequestId?: string

  @IsString()
  title!: string

  @IsOptional()
  @IsString()
  bitrixProjectId?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  projectAmount?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  summaryMarginPercent?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  summaryPurchasedHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  summaryPlanHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  summaryFactHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tzPurchasedHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tzPlanHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tzFactHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  developmentPurchasedHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  educationPurchasedHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  educationPlanHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  educationFactHours?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  summaryLossHours?: number | null

  @IsOptional()
  @IsDateString()
  summaryPlanCompletionDate?: string | null

  @IsOptional()
  @IsDateString()
  summaryFactCompletionDate?: string | null

  @IsOptional()
  @IsEnum(ReportProjectType)
  projectType?: ReportProjectType

  @IsOptional()
  @IsEnum(ReportProjectStatus)
  projectStatus?: ReportProjectStatus | null

  @IsOptional()
  @IsString()
  projectGoal?: string | null

  @IsOptional()
  @IsDateString()
  projectStartDate?: string | null

  @IsOptional()
  @IsDateString()
  contractEndDate?: string | null

  @IsOptional()
  @IsString()
  clientCompany?: string | null

  @IsOptional()
  @IsString()
  deal?: string | null

  @IsOptional()
  @IsDateString()
  nextReportDate?: string | null

  @IsOptional()
  @IsString()
  reportInfo?: string | null

  @IsOptional()
  @IsDateString()
  deadline?: string | null

  @IsOptional()
  @IsDateString()
  redline?: string | null

  @IsOptional()
  @IsString()
  responsible?: string | null

  @IsOptional()
  @IsString()
  responsibleId?: string | null

  @IsOptional()
  @IsString()
  salesManager?: string | null

  @IsOptional()
  @IsString()
  salesManagerId?: string | null

  @IsOptional()
  @IsString()
  analyst?: string | null

  @IsOptional()
  @IsString()
  analystId?: string | null

  @IsOptional()
  @IsString()
  developmentTeam?: string | null

  @IsOptional()
  @IsString()
  developmentTeamIds?: string | null

  @IsOptional()
  @IsString()
  qa?: string | null

  @IsOptional()
  @IsString()
  qaId?: string | null

  @IsOptional()
  @IsDateString()
  tzStartDate?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  tzWeeks?: number | null

  @IsOptional()
  @IsDateString()
  tzPlanEndDate?: string | null

  @IsOptional()
  @IsDateString()
  tzFactEndDate?: string | null

  @IsOptional()
  @IsDateString()
  tzSignDate?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  developmentWeeks?: number | null

  @IsOptional()
  @IsDateString()
  developmentPlanStartDate?: string | null

  @IsOptional()
  @IsDateString()
  developmentPlanEndDate?: string | null

  @IsOptional()
  @IsDateString()
  developmentFactStartDate?: string | null

  @IsOptional()
  @IsDateString()
  developmentFactEndDate?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  educationWeeks?: number | null

  @IsOptional()
  @IsDateString()
  educationPlanStartDate?: string | null

  @IsOptional()
  @IsDateString()
  educationPlanEndDate?: string | null

  @IsOptional()
  @IsDateString()
  educationFactStartDate?: string | null

  @IsOptional()
  @IsDateString()
  educationFactEndDate?: string | null

  @IsOptional()
  @IsDateString()
  closeDate?: string | null
}
