import { Module } from '@nestjs/common'
import { DocRecordsService } from './doc-records.service'
import { DocRecordsController } from './doc-records.controller'
import { HttpModule } from '@nestjs/axios'
import { BitrixModule } from 'src/shared/integrations/bitrix/bitrix.module'
import { PdfModule } from 'src/shared/pdf/pdf.module'

@Module({
  imports: [HttpModule, BitrixModule, PdfModule],
  controllers: [DocRecordsController],
  providers: [DocRecordsService],
})
export class DocRecordsModule {}
