import { IsDateString, IsNotEmpty, IsString } from 'class-validator'

export class CreateDocRecordDto {
  @IsString()
  @IsNotEmpty()
  id: string

  @IsString()
  @IsNotEmpty()
  startOfThePeriod: string

  @IsString()
  @IsNotEmpty()
  endOfThePeriod: string
}
