import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateReportProjectDto } from './create-project-report-project.dto'
import { UpdateReportProjectDto } from './update-project-report-project.dto'

describe('report project company creation DTO', () => {
  it('accepts a new company title in the create contract', async () => {
    const dto = plainToInstance(CreateReportProjectDto, { title: 'Project', projectGoal: 'Goal', newCompanyTitle: 'Acme', clientCompanyId: null })
    await expect(validate(dto)).resolves.toEqual([])
  })

  it.each([123, 'x'.repeat(256)])('rejects invalid company title input %j', async (newCompanyTitle) => {
    const dto = plainToInstance(CreateReportProjectDto, { title: 'Project', newCompanyTitle })
    expect((await validate(dto)).some((error) => error.property === 'newCompanyTitle')).toBe(true)
  })

  it('excludes creation-only company data from an update request with whitelist validation', async () => {
    const dto = plainToInstance(UpdateReportProjectDto, { title: 'Changed', newCompanyTitle: 'Must not create', creationRequestId: '01a110ba-c8de-4de0-96b7-aef6a762b340' })
    await validate(dto, { whitelist: true })
    expect(dto.title).toBe('Changed')
    expect(dto).not.toHaveProperty('newCompanyTitle')
    expect(dto).not.toHaveProperty('creationRequestId')
  })
})
