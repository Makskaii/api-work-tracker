import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ProjectGanttEvent } from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ProjectReportProject } from './entities/project-report-project.entity'
import { ProjectReportsController } from './project-reports.controller'
import { ProjectReportsService } from './project-reports.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectReportProject,
      ProjectGanttStage,
      ProjectGanttEvent,
      ProjectPayment,
    ]),
  ],
  controllers: [ProjectReportsController],
  providers: [ProjectReportsService],
})
export class ProjectReportsModule {}
