import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from 'class-validator'
import { GanttCustomEventKind } from '../entities/gantt-custom-event.entity'

export class CreateGanttEventDto {
  @IsString()
  title!: string

  @IsEnum(GanttCustomEventKind)
  eventKind!: GanttCustomEventKind

  @IsOptional()
  @IsDateString()
  planStartDate?: string | null

  @IsOptional()
  @IsDateString()
  planEndDate?: string | null

  @IsOptional()
  @IsDateString()
  factStartDate?: string | null

  @IsOptional()
  @IsDateString()
  factEndDate?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number | null
}
