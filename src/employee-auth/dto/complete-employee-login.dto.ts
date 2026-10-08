import { IsOptional, IsString, Length, Matches } from 'class-validator'

export class CompleteEmployeeLoginDto {
  @IsString()
  @Length(1, 2048)
  @Matches(/^[\x21-\x7e]+$/)
  code!: string

  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  state!: string

  @IsOptional()
  @IsString()
  @Length(1, 253)
  domain?: string
}
