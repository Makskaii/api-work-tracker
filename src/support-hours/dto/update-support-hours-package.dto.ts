import { Type } from 'class-transformer'
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator'

export class UpdateSupportHoursPackageDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  purchasedHours?: number

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsDateString()
  purchaseDate?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number | null

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null
}
