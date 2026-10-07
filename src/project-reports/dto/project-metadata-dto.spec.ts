import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { CreateReportProjectDto } from './create-project-report-project.dto'
import { UpdateReportProjectDto } from './update-project-report-project.dto'

describe.each([
  { contract: 'create', metatype: CreateReportProjectDto },
  { contract: 'update', metatype: UpdateReportProjectDto },
])('$contract metadata HTTP validation', ({ metatype }) => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })
  const parse = (body: object) => pipe.transform({ title: 'Project', ...body }, { type: 'body', metatype })

  it.each([-1, -0.25, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects invalid purchased hours %s', async (summaryPurchasedHours) => {
    await expect(parse({ summaryPurchasedHours })).rejects.toBeInstanceOf(BadRequestException)
  })

  it.each([0, 12.5, null])('preserves purchased hours %s', async (summaryPurchasedHours) => {
    await expect(parse({ summaryPurchasedHours })).resolves.toMatchObject({ summaryPurchasedHours })
  })

  it('retains omission and converts a valid numeric input consistently with the other hours fields', async () => {
    expect((await parse({})).summaryPurchasedHours).toBeUndefined()
    await expect(parse({ summaryPurchasedHours: '12.5' })).resolves.toMatchObject({ summaryPurchasedHours: 12.5 })
  })

  it.each(['', 'not-a-date'])('rejects a malformed single-date update %j', async (contractEndDate) => {
    await expect(parse({ contractEndDate })).rejects.toBeInstanceOf(BadRequestException)
  })

  it('allows partial dates and an explicit cleared date for service-level comparison with saved values', async () => {
    await expect(parse({ contractEndDate: '2026-12-01' })).resolves.toMatchObject({ contractEndDate: '2026-12-01' })
    await expect(parse({ projectStartDate: null })).resolves.toMatchObject({ projectStartDate: null })
  })
})
