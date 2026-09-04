import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ReportProject } from '../project-reports/entities/project-report-project.entity'
import { BitrixModule } from '../shared/integrations/bitrix/bitrix.module'
import { SupportHoursPackagesController } from './support-hours-packages.controller'
import { SupportHoursPackagesScheduler } from './support-hours-packages.scheduler'
import { SupportHoursPackagesService } from './support-hours-packages.service'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'

@Module({
  imports: [BitrixModule, TypeOrmModule.forFeature([ReportProject, SupportHoursPackage, SupportHoursReport, SupportHoursConsumption])],
  controllers: [SupportHoursPackagesController],
  providers: [SupportHoursPackagesService, SupportHoursPackagesScheduler],
})
export class SupportHoursPackagesModule {}
