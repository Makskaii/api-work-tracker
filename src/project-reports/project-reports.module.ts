import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BitrixModule } from '../shared/integrations/bitrix/bitrix.module'
import { ProjectBitrixService } from './project-bitrix.service'
import { ProjectGanttEvent } from './entities/project-gantt-event.entity'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'
import { ProjectReportEntryFile } from './entities/project-report-entry-file.entity'
import { ProjectReportEntry } from './entities/project-report-entry.entity'
import { ReportProject } from './entities/project-report-project.entity'
import { ReportProjectFile } from './entities/report-project-file.entity'
import { ProjectGanttService } from './project-gantt.service'
import { ProjectPaymentsService } from './project-payments.service'
import { ProjectReportEntriesService } from './project-report-entries.service'
import { ProjectReportFilesService } from './project-report-files.service'
import { ProjectReportsController } from './project-reports.controller'
import { ProjectReportsService } from './project-reports.service'

@Module({
  imports: [
    BitrixModule,
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
  providers: [
    ProjectBitrixService,
    ProjectReportsService,
    ProjectReportFilesService,
    ProjectReportEntriesService,
    ProjectGanttService,
    ProjectPaymentsService,
  ],
})
export class ProjectReportsModule {}
