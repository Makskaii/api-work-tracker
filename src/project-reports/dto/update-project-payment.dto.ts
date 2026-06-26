import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator'
import { ProjectPaymentStatus } from '../entities/project-payment.entity'

export class UpdateProjectPaymentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stageId?: number

  @IsOptional()
  @IsEnum(ProjectPaymentStatus)
  status?: ProjectPaymentStatus

  @IsOptional()
  @IsDateString()
  paymentDate?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  percent?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  waitingDays?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number | null
}
