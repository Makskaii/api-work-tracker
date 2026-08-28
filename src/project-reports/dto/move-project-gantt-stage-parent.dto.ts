import { Type } from 'class-transformer'
import { IsInt } from 'class-validator'

export class MoveProjectGanttStageParentDto {
  @Type(() => Number)
  @IsInt()
  parentStageId!: number
}
