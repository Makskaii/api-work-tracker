import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common'
import { CreateSupportHoursPackageDto } from './dto/create-support-hours-package.dto'
import { UpdateSupportHoursPackageDto } from './dto/update-support-hours-package.dto'
import { SupportHoursPackagesService } from './support-hours-packages.service'

@Controller('support-hours-packages')
export class SupportHoursPackagesController {
  constructor(private readonly service: SupportHoursPackagesService) {}

  @Get()
  findAll() {
    return this.service.findAll()
  }

  @Get('projects')
  findSupportProjects() {
    return this.service.findSupportProjects()
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
  receiveReportWebhookPost(@Body() body: Record<string, unknown>) {
    return this.service.processReportWebhook(body)
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

  @Post('sync')
  sync() {
    return this.service.sync()
  }
}
