import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { DownloadSupportPackageReportDto, validateSupportPackageReportScope } from './dto/download-support-package-report.dto'
import { SupportHoursPackagesController } from './support-hours-packages.controller'

const now = new Date('2026-09-29T08:00:00Z')

describe('Support package PDF date scope', () => {
  it.each([undefined, {}])('keeps %p as a complete package report', (input) => {
    expect(validateSupportPackageReportScope(input, now)).toBeUndefined()
  })

  it.each([
    { dateFrom: '2026-09-01', dateTo: '2026-09-29' },
    { dateFrom: '2026-09-29', dateTo: '2026-09-29' },
    { dateFrom: '2024-02-29', dateTo: '2024-02-29' },
  ])('accepts inclusive actual calendar dates %p', (input) => {
    expect(validateSupportPackageReportScope(input, now)).toEqual(input)
  })

  it.each([
    { dateFrom: '2026-09-01' },
    { dateTo: '2026-09-29' },
    { dateFrom: null, dateTo: null },
    { dateFrom: '', dateTo: '' },
    { dateFrom: '2026-02-29', dateTo: '2026-03-01' },
    { dateFrom: '2026-04-31', dateTo: '2026-05-01' },
    { dateFrom: '2026-09-01T00:00:00Z', dateTo: '2026-09-29' },
    { dateFrom: '2026-9-01', dateTo: '2026-09-29' },
    { dateFrom: '2026-09-29', dateTo: '2026-09-01' },
    { dateFrom: '2026-09-01', dateTo: '2026-09-30' },
    { dateFrom: 20260901, dateTo: '2026-09-29' },
    { dateFrom: '2026-09-01', dateTo: '2026-09-29', includeAllPackages: true },
    null,
    [],
    '2026-09-01',
  ])('rejects invalid scope %p', (input) => {
    expect(() => validateSupportPackageReportScope(input, now)).toThrow(BadRequestException)
  })

  it('uses Moscow today, including its midnight before UTC midnight', () => {
    const scope = { dateFrom: '2026-09-30', dateTo: '2026-09-30' }
    expect(() => validateSupportPackageReportScope(scope, new Date('2026-09-29T20:59:59Z'))).toThrow(BadRequestException)
    expect(validateSupportPackageReportScope(scope, new Date('2026-09-29T21:00:00Z'))).toEqual(scope)
  })

  it('rejects invalid dates and unknown fields through the application validation pipe', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })
    const metadata = { type: 'body' as const, metatype: DownloadSupportPackageReportDto }
    await expect(pipe.transform({ dateFrom: '2026-02-29', dateTo: '2026-09-29' }, metadata)).rejects.toThrow(BadRequestException)
    await expect(pipe.transform({ dateFrom: null, dateTo: '2026-09-29' }, metadata)).rejects.toThrow(BadRequestException)
    await expect(pipe.transform({ dateFrom: '2026-09-01', dateTo: '2026-09-29', extra: true }, metadata)).rejects.toThrow(BadRequestException)
    const validated = await pipe.transform({ dateFrom: '2026-09-01', dateTo: '2026-09-29' }, metadata)
    expect(validateSupportPackageReportScope(validated, now)).toEqual({ dateFrom: '2026-09-01', dateTo: '2026-09-29' })
  })
})

describe('Support package PDF controller scope', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now))
  afterEach(() => jest.useRealTimers())

  function fixture() {
    const reportService = { generate: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-test'), filename: 'report.pdf' }) }
    const controller = new SupportHoursPackagesController({} as never, reportService as never, {} as never, {} as never, {} as never, {} as never)
    return { controller, reportService }
  }

  it('passes a validated date range to PDF generation', async () => {
    const { controller, reportService } = fixture()
    const scope = { dateFrom: '2026-09-01', dateTo: '2026-09-29' }
    const response = await controller.downloadPackageReport(10, scope)
    expect(reportService.generate).toHaveBeenCalledWith(10, scope)
    expect(response.getHeaders()).toMatchObject({ type: 'application/pdf', disposition: 'attachment; filename="report.pdf"' })
  })

  it.each([undefined, {}])('preserves full-package generation for %p', async (input) => {
    const { controller, reportService } = fixture()
    await controller.downloadPackageReport(10, input)
    expect(reportService.generate).toHaveBeenCalledWith(10)
  })

  it('rejects an incomplete range before refreshing Bitrix or rendering PDF', async () => {
    const { controller, reportService } = fixture()
    await expect(controller.downloadPackageReport(10, { dateFrom: '2026-09-01' })).rejects.toThrow(BadRequestException)
    expect(reportService.generate).not.toHaveBeenCalled()
  })
})
