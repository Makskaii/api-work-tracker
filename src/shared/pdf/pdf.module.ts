import { Module } from '@nestjs/common'
import { HtmlBuilderService } from './builder.service'
import { PdfService } from './pdf.service'

@Module({
  providers: [HtmlBuilderService, PdfService],
  exports: [HtmlBuilderService, PdfService],
})
export class PdfModule {}
