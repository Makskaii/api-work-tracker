import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common'
import type { Response } from 'express'
import { DocRecordsService } from './doc-records.service'
import { CreateDocRecordDto } from './dto/create-doc-record.dto'

@Controller('/doc-records')
export class DocRecordsController {
  constructor(private readonly docRecordsService: DocRecordsService) {}

  @Get()
  health() {
    return {
      message: 'wprking',
    }
  }

  @Post('report')
  async createReport(@Body() data: CreateDocRecordDto) {
    return await this.docRecordsService.prepareReport(
      data.projectId,
      data.startOfThePeriod,
      data.endOfThePeriod,
    )
  }

  @Get('report/:id')
  async downloadReport(@Param('id') id: string, @Res() res: Response) {
    const report = await this.docRecordsService.getPreparedReport(id)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${report.filename}"`,
    )

    res.send(report.buffer)
  }
}
