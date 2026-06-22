import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator'
import { GanttIncidentEntityType } from '../entities/gantt-incident.entity'

export class UpdateGanttIncidentDto {
  @IsOptional()
  @IsEnum(GanttIncidentEntityType)
  entityType?: GanttIncidentEntityType

  @IsOptional()
  @IsString()
  entityId?: string

  @IsOptional()
  @IsString()
  title?: string | null

  @IsOptional()
  @IsString()
  description?: string | null

  @IsOptional()
  @IsDateString()
  incidentDate?: string
}
