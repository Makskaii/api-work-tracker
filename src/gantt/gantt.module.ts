import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { GanttCustomEvent } from './entities/gantt-custom-event.entity'
import { GanttIncidentFile } from './entities/gantt-incident-file.entity'
import { GanttIncident } from './entities/gantt-incident.entity'
import { GanttController } from './gantt.controller'
import { GanttService } from './gantt.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GanttCustomEvent,
      GanttIncident,
      GanttIncidentFile,
    ]),
  ],
  controllers: [GanttController],
  providers: [GanttService],
})
export class GanttModule {}
