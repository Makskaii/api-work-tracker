import { IsDateString, IsOptional, IsString } from 'class-validator'

export class UpdateProjectReportEntryDto {
  @IsOptional()
  @IsString()
  authorName?: string

  @IsOptional()
  @IsString()
  authorId?: string | null

  @IsOptional()
  @IsString()
  text?: string

  @IsOptional()
  @IsDateString()
  nextReportDate?: string | null
}
