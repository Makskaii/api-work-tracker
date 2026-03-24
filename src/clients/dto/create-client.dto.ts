import { Type } from 'class-transformer'
import { IsEmail, IsInt, IsString, MinLength } from 'class-validator'

export class CreateClientDto {
  @IsString()
  name: string

  @Type(() => Number)
  @IsInt()
  crmId: number

  @IsString()
  @MinLength(8)
  password: string

  @IsEmail()
  email: string
}
