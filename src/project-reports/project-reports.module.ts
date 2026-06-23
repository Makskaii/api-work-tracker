import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ProjectGanttEvent } from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ProjectReportEntryFile } from './entities/project-report-entry-file.entity'
import { ProjectReportEntry } from './entities/project-report-entry.entity'
import { ReportProject } from './entities/project-report-project.entity'
import { ReportProjectFile } from './entities/report-project-file.entity'
import { ProjectReportsController } from './project-reports.controller'
import { ProjectReportsService } from './project-reports.service'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ReportProject,
      ProjectGanttStage,
      ProjectGanttEvent,
      ProjectPayment,
      ReportProjectFile,
      ProjectReportEntry,
      ProjectReportEntryFile,
    ]),
  ],
  controllers: [ProjectReportsController],
  providers: [ProjectReportsService],
})
export class ProjectReportsModule {}
