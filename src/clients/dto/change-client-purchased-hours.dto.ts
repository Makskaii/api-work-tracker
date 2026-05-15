import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class ChangeClientPurchasedHoursDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  hours: number

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string
}
