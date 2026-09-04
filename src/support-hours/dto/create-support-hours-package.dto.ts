import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreateSupportHoursPackageDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  projectId: number

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  purchasedHours: number

  @IsDateString()
  purchaseDate: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string
}
