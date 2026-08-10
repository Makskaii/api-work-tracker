import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectReportEntryFile } from '../project-reports/entities/project-report-entry-file.entity';
import { ReportProjectFile } from '../project-reports/entities/report-project-file.entity';
import { GanttIncidentFile } from '../gantt/entities/gantt-incident-file.entity';
import { StorageMonitorService } from './storage-monitor.service';
import { STORAGE_CLEANUP_DRY_RUN, STORAGE_CLEANUP_THRESHOLD } from '../constants/const';

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);

  constructor(
    @InjectRepository(ProjectReportEntryFile) private readonly entryFileRepo: Repository<ProjectReportEntryFile>,
    @InjectRepository(ReportProjectFile) private readonly projectFileRepo: Repository<ReportProjectFile>,
    @InjectRepository(GanttIncidentFile) private readonly incidentFileRepo: Repository<GanttIncidentFile>,
    private readonly monitorService: StorageMonitorService,
  ) {}

  async runCleanup() {
    const stats = await this.monitorService.getStorageStats();
    
    if (!stats.isAboveThreshold) {
      this.logger.log(`Storage usage (${stats.usagePercentage.toFixed(2)}%) is below threshold. Skipping.`);
      return;
    }

    this.logger.log(`Storage usage (${stats.usagePercentage.toFixed(2)}%) is above threshold. Starting cleanup...`);

    const files = await this.getAllFiles();
    // Sort by createdAt ascending (oldest first)
    files.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    const bytesToFree = stats.used - (stats.total * 0.8); // Aim for 80% usage
    let bytesFreed = 0;
    let filesRemoved = 0;

    for (const file of files) {
      if (bytesFreed >= bytesToFree) break;

      const filePath = path.join(process.cwd(), file.storagePath || '');
      
      try {
        if (!STORAGE_CLEANUP_DRY_RUN) {
          await fs.unlink(filePath);
          await this.removeFileRecord(file);
        }
        
        bytesFreed += file.sizeBytes;
        filesRemoved++;
        this.logger.log(`[${STORAGE_CLEANUP_DRY_RUN ? 'DRY-RUN' : 'CLEANUP'}] Removed: ${filePath}`);
      } catch (err) {
        this.logger.error(`Failed to remove file: ${filePath}`, err);
      }
    }

    this.logger.log(`Cleanup finished. Removed: ${filesRemoved} files. Freed: ${(bytesFreed / (1024 * 1024 * 1024)).toFixed(2)} GB.`);
  }

  private async getAllFiles() {
    const entryFiles = await this.entryFileRepo.find();
    const projectFiles = await this.projectFileRepo.find();
    const incidentFiles = await this.incidentFileRepo.find();
    
    const formattedEntryFiles = entryFiles.map(f => ({
        ...f,
        storagePath: f.path,
        sizeBytes: f.size,
        createdAt: new Date(f.createdAt)
    }));

    const formattedProjectFiles = projectFiles.map(f => ({
        ...f,
        sizeBytes: f.sizeBytes,
        createdAt: new Date(f.createdAt)
    }));

    const formattedIncidentFiles = incidentFiles.map(f => ({
        ...f,
        sizeBytes: f.sizeBytes,
        createdAt: new Date(f.createdAt)
    }));
    
    return [...formattedEntryFiles, ...formattedProjectFiles, ...formattedIncidentFiles];
  }

  private async removeFileRecord(file: any) {
    if (file instanceof ProjectReportEntryFile) await this.entryFileRepo.remove(file);
    else if (file instanceof ReportProjectFile) await this.projectFileRepo.remove(file);
    else if (file instanceof GanttIncidentFile) await this.incidentFileRepo.remove(file);
  }
}
