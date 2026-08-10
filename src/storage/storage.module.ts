import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageMonitorService } from './storage-monitor.service';
import { StorageCleanupService } from './storage-cleanup.service';
import { ProjectReportEntryFile } from '../project-reports/entities/project-report-entry-file.entity';
import { ReportProjectFile } from '../project-reports/entities/report-project-file.entity';
import { GanttIncidentFile } from '../gantt/entities/gantt-incident-file.entity';
import { StorageCronService } from './storage-cron.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectReportEntryFile, ReportProjectFile, GanttIncidentFile]),
  ],
  providers: [StorageMonitorService, StorageCleanupService, StorageCronService],
  exports: [StorageMonitorService, StorageCleanupService],
})
export class StorageModule {}
