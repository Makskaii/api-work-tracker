import { Type } from 'class-transformer'
import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class UpdateSupportHoursPackageDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  purchasedHours?: number

  @IsOptional()
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
