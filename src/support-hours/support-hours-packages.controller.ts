import { PreviewSupportHoursPackageDto } from './dto/preview-support-hours-package.dto'
import { SupportHoursPackageImpactService } from './support-hours-package-impact.service'
import { CreateSupportReportVersionDto } from './dto/create-support-report-version.dto'
import { PrepareSupportReportDto } from './dto/prepare-support-report.dto'
import { SupportHoursReportVersionsService } from './support-hours-report-versions.service'
import { SupportReportEditorService } from './support-report-editor.service'
import { SupportPackageChecksService } from './support-package-checks.service'
import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseIntPipe, Patch, Post, Query, StreamableFile } from '@nestjs/common'
import { CreateSupportHoursPackageDto } from './dto/create-support-hours-package.dto'
import { UpdateSupportHoursPackageDto } from './dto/update-support-hours-package.dto'
import { SupportHoursPackageReportService } from './support-hours-package-report.service'
import { SupportHoursPackagesService } from './support-hours-packages.service'

@Controller('support-hours-packages')
export class SupportHoursPackagesController {
  constructor(
    private readonly service: SupportHoursPackagesService,
    private readonly reportService: SupportHoursPackageReportService,
    private readonly versionsService: SupportHoursReportVersionsService,
    private readonly editorService: SupportReportEditorService,
    private readonly checksService: SupportPackageChecksService,
    private readonly impactService: SupportHoursPackageImpactService,
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

  @Get('projects/:id/workspace')
  @Header('Cache-Control', 'no-store')
  getProjectWorkspace(@Param('id', ParseIntPipe) id: number) {
    return this.service.getProjectWorkspace(id)
  }

  @Get('reports/form-options')
  formOptions() { return this.editorService.formOptions() }

  @Get('reports/:id/edit')
  editReport(@Param('id', ParseIntPipe) id: number, @Query('projectId', ParseIntPipe) projectId: number) {
    return this.editorService.edit(projectId, id)
  }

  @Post('projects/:id/report-fields')
  prepareReport(@Param('id', ParseIntPipe) id: number, @Body() dto: PrepareSupportReportDto) {
    return this.editorService.prepare(id, dto)
  }

  @Get(':id/checks')
  checkReport(@Param('id', ParseIntPipe) id: number) { return this.checksService.check(id) }

  @Get('projects/:id/report-versions')
  listVersions(@Param('id', ParseIntPipe) id: number, @Query('packageId', new ParseIntPipe({ optional: true })) packageId?: number) {
    return this.versionsService.list(id, packageId)
  }

  @Post(':id/report-versions')
  saveVersion(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateSupportReportVersionDto) {
    return this.versionsService.create(id, dto)
  }

  @Get('report-versions/:id/download')
  @Header('Cache-Control', 'no-store')
  async downloadVersion(@Param('id', ParseIntPipe) id: number) {
    const report = await this.versionsService.download(id)
    return new StreamableFile(report.buffer, {
      type: 'application/pdf', disposition: `attachment; filename="${report.filename}"`, length: report.buffer.length,
    })
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

  @Post(':id/impact')
  async previewImpact(@Param('id', ParseIntPipe) id: number, @Body() dto: PreviewSupportHoursPackageDto) {
    await this.service.sync()
    return this.impactService.preview(id, dto)
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSupportHoursPackageDto, @Headers('if-match') fingerprint?: string) {
    return this.service.update(id, dto, fingerprint)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number, @Headers('if-match') fingerprint?: string) {
    return this.service.remove(id, fingerprint)
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
