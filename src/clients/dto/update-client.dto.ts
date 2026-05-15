import { Transform } from 'class-transformer'
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'
import { ClientStatus } from '../entities/client.entity'

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

const toNumberIfPresent = ({ value }: { value: unknown }) => {
  if (value === undefined || value === null || value === '') {
    return value
  }

  return Number(value)
}

export class UpdateClientDto {
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @MinLength(1)
  name?: string

  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimString)
  @IsEmail()
  email?: string

  @ValidateIf((_, value) => value !== undefined)
  @Transform(toNumberIfPresent)
  @IsInt()
  crmId?: number

  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(ClientStatus)
  status?: ClientStatus

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @Transform(toNumberIfPresent)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchasedHours?: number | null
}
