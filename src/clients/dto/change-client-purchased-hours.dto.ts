import { Type } from 'class-transformer'
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'

export class ChangeClientPurchasedHoursDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  hours: number

  @IsOptional()
  @IsDateString()
  date?: string

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
