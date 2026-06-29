import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator'
import {
  ProjectPaymentAnchor,
  ProjectPaymentStatus,
} from '../entities/project-payment.entity'

export class CreateProjectPaymentDto {
  @Type(() => Number)
  @IsInt()
  stageId!: number

  @IsEnum(ProjectPaymentStatus)
  status!: ProjectPaymentStatus

  @IsOptional()
  @IsEnum(ProjectPaymentAnchor)
  paymentAnchor?: ProjectPaymentAnchor | null

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
