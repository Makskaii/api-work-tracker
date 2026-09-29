import { Type } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator'

export class TransferSupportReportDto {
  @IsString() @Matches(/^[1-9]\d*$/) reportId!: string
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99999999.99) hours!: number
}
export class TransferSupportHoursDto {
  @IsOptional() @IsInt() @Min(1) fromPurchaseId!: number | null
  @IsOptional() @IsInt() @Min(1) toPurchaseId!: number | null
  @IsOptional() @IsString() @Matches(/^[1-9]\d*$/) taskId?: string
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => TransferSupportReportDto) items!: TransferSupportReportDto[]
}
