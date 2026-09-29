import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseIntPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common'
import { CreateSupportHoursPackageDto } from './dto/create-support-hours-package.dto'
import { UpdateSupportHoursPackageDto } from './dto/update-support-hours-package.dto'
import { SupportHoursPackageReportService } from './support-hours-package-report.service'
import { SupportHoursPackagesService } from './support-hours-packages.service'

@Controller('support-hours-packages')
export class SupportHoursPackagesController {
  constructor(
    private readonly service: SupportHoursPackagesService,
    private readonly reportService: SupportHoursPackageReportService,
  ) {}

  @Get()
  findAll() {
    return this.service.findAll()
  }

  @Get('projects')
  findSupportProjects() {
    return this.service.findSupportProjects()
  }

  @Get('projects/:id/tasks')
  findSupportProjectTasks(@Param('id', ParseIntPipe) id: number) {
    return this.service.findSupportProjectTasks(id)
  }

  @Post('projects/sync')
  syncSupportProjects() {
    return this.service.syncSupportProjects()
  }

  @Get('reports/webhook')
  @HttpCode(202)
  receiveReportWebhookGet(@Query() query: Record<string, unknown>) {
    return this.service.processReportWebhook(query)
  }

  @Post('reports/webhook')
  @HttpCode(202)
  receiveReportWebhookPost(
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ) {
    return this.service.processReportWebhook({ ...body, ...query })
  }

  @Post()
  create(@Body() dto: CreateSupportHoursPackageDto) {
    return this.service.create(dto)
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupportHoursPackageDto) {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id)
  }

  @Post(':id/report')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async downloadPackageReport(@Param('id', ParseIntPipe) id: number) {
    const report = await this.reportService.generate(id)
    return new StreamableFile(report.buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${report.filename}"`,
      length: report.buffer.length,
    })
  }

  @Post('sync')
  sync() {
    return this.service.sync()
  }
}
