import { SupportHoursPackageImpactService } from './support-hours-package-impact.service'
import { SupportHoursReportVersion } from './entities/support-hours-report-version.entity'
import { SupportHoursReportVersionsService } from './support-hours-report-versions.service'
import { SupportReportEditorService } from './support-report-editor.service'
import { SupportPackageChecksService } from './support-package-checks.service'
import { PdfModule } from '../shared/pdf/pdf.module'
import { SupportHoursPackageReportService } from './support-hours-package-report.service'
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
  imports: [BitrixModule, PdfModule, TypeOrmModule.forFeature([ReportProject, SupportHoursPackage, SupportHoursReport, SupportHoursConsumption, SupportHoursReportVersion])],
  controllers: [SupportHoursPackagesController],
  providers: [SupportHoursPackageImpactService, SupportReportEditorService, SupportPackageChecksService, SupportHoursReportVersionsService, SupportHoursPackagesService, SupportHoursPackagesScheduler, SupportHoursPackageReportService],
})
export class SupportHoursPackagesModule {}
