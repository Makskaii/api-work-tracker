import { IsNotEmpty, IsString } from 'class-validator'

export class CreateDocRecordDto {
  @IsString()
  @IsNotEmpty()
  projectId: string

  @IsString()
  @IsNotEmpty()
  startOfThePeriod: string

  @IsString()
  @IsNotEmpty()
  endOfThePeriod: string
}
