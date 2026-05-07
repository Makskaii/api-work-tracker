import { Type } from 'class-transformer'
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  employeeId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  activityId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  activityName!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  clientId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clientName!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  projectId!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  projectName!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  hours!: number
}
