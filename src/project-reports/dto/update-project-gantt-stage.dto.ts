import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString } from 'class-validator'

export class UpdateProjectGanttStageDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  code?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number | null
}
