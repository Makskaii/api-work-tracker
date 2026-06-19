import { GanttIncidentEntityType } from '../entities/gantt-incident.entity'

export class CreateGanttIncidentDto {
  entityType!: GanttIncidentEntityType
  entityId!: string
  title!: string
  description?: string | null
  incidentDate!: string
}
