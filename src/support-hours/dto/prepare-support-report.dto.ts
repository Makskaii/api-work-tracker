import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'

export class PrepareSupportReportDto {
  @IsOptional() @IsInt() @Min(1) taskId?: number | null
  @IsOptional() @IsInt() @Min(1) reportId?: number
  @IsString() @MaxLength(20000) description!: string
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999999.99) hours!: number
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) reportDate!: string
  @IsBoolean() includeInPackage!: boolean
  @IsInt() @Min(1) activityId!: number
}
