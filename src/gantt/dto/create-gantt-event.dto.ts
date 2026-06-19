import { GanttCustomEventKind } from '../entities/gantt-custom-event.entity'

export class CreateGanttEventDto {
  title!: string
  eventKind!: GanttCustomEventKind
  planStartDate?: string | null
  planEndDate?: string | null
  factStartDate?: string | null
  factEndDate?: string | null
  sortOrder?: number | null
}
