import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { STORAGE_CLEANUP_THRESHOLD } from '../constants/const';

@Injectable()
export class StorageMonitorService {
  private readonly logger = new Logger(StorageMonitorService.name);

  async getStorageStats(storagePath: string = process.cwd()) {
    try {
      const stats = await fs.promises.statfs(storagePath);
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      const usagePercentage = (used / total) * 100;

      return {
        total,
        used,
        free,
        usagePercentage,
        isAboveThreshold: usagePercentage >= STORAGE_CLEANUP_THRESHOLD,
      };
    } catch (error) {
      this.logger.error('Failed to get storage stats', error);
      throw error;
    }
  }
}
