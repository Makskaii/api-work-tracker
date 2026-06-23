import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString } from 'class-validator'

export class CreateProjectGanttStageDto {
  @IsString()
  title!: string

  @IsString()
  code!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number | null
}
