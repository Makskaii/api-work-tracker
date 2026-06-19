import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator'
import { GanttIncidentEntityType } from '../entities/gantt-incident.entity'

export class CreateGanttIncidentDto {
  @IsEnum(GanttIncidentEntityType)
  entityType!: GanttIncidentEntityType

  @IsString()
  entityId!: string

  @IsOptional()
  @IsString()
  title?: string | null

  @IsOptional()
  @IsString()
  description?: string | null

  @IsDateString()
  incidentDate!: string
}
