import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class CreateProjectReportEntryDto {
  @IsString()
  @IsNotEmpty()
  authorName!: string

  @IsOptional()
  @IsString()
  authorId?: string | null

  @IsString()
  @IsNotEmpty()
  text!: string

  @IsOptional()
  @IsDateString()
  nextReportDate?: string | null
}
