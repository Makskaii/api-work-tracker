import { Type } from 'class-transformer'
import { IsInt, IsOptional, Min } from 'class-validator'

export class MoveProjectGanttStageParentDto {
  @Type(() => Number)
  @IsInt()
  parentStageId!: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeStageId?: number | null
}
