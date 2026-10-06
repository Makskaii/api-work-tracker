import { BadRequestException, ConflictException } from '@nestjs/common'
import { ReportProject } from './entities/project-report-project.entity'
import { ProjectReportsService } from './project-reports.service'

function makeUpdateEnvironment(bitrixProjectId: string | null = '901') {
  const project = { id: 1, title: 'Local report title', bitrixProjectId, clientCompany: 'Legacy company', clientCompanyId: null, files: [] } as unknown as ReportProject
  const repository = { findOne: jest.fn().mockResolvedValue(project), save: jest.fn((value: ReportProject) => Promise.resolve(value)) }
  const bitrix = {
    optionalProjectId: jest.fn((value: unknown) => value == null || value === '' ? null : String(value)),
    resolveProjectLink: jest.fn().mockResolvedValue({ bitrixProjectId: '901', clientCompanyId: '215', clientCompany: 'Acme', title: 'Bitrix title' }),
    resolveCompany: jest.fn().mockResolvedValue({ clientCompanyId: '215', clientCompany: 'Acme' }),
    createProject: jest.fn(),
    withProjectLock: jest.fn((_id: string, operation: () => Promise<ReportProject>) => operation()),
  }
  const service = new ProjectReportsService(repository as never, {} as never, {} as never, {} as never, bitrix as never)
  return { service, repository, bitrix, project }
}

describe('ProjectReportsService.updateProject Bitrix linking', () => {
  it('refreshes the authoritative company while preserving normal edits', async () => {
    const env = makeUpdateEnvironment()
    const result = await env.service.updateProject(1, { projectAmount: 100, title: '  Edited report  ', clientCompanyId: '999', clientCompany: 'Wrong' })
    expect(result).toMatchObject({ projectAmount: 100, title: 'Edited report', bitrixProjectId: '901', clientCompanyId: '215', clientCompany: 'Acme' })
    expect(env.bitrix.resolveProjectLink).toHaveBeenCalledWith('901')
    expect(env.bitrix.createProject).not.toHaveBeenCalled()
  })

  it('preserves an unlinked legacy project without silently creating a card', async () => {
    const env = makeUpdateEnvironment(null)
    const result = await env.service.updateProject(1, { projectAmount: 100 })
    expect(result.clientCompany).toBe('Legacy company')
    expect(result.bitrixProjectId).toBeNull()
    expect(env.bitrix.resolveProjectLink).not.toHaveBeenCalled()
    expect(env.bitrix.resolveCompany).not.toHaveBeenCalled()
    expect(env.bitrix.createProject).not.toHaveBeenCalled()
  })

  it('resolves a selected company for an unlinked project without creating a card', async () => {
    const env = makeUpdateEnvironment(null)
    const result = await env.service.updateProject(1, { clientCompanyId: '215', clientCompany: 'Wrong' })
    expect(result.clientCompany).toBe('Acme')
    expect(result.clientCompanyId).toBe('215')
    expect(env.bitrix.createProject).not.toHaveBeenCalled()
  })

  it('locks a newly selected card and rejects a link already owned by another local project', async () => {
    const env = makeUpdateEnvironment(null)
    env.repository.findOne.mockResolvedValueOnce(env.project).mockResolvedValueOnce({ id: 99, bitrixProjectId: '901' })
    await expect(env.service.updateProject(1, { bitrixProjectId: '901' })).rejects.toBeInstanceOf(ConflictException)
    expect(env.bitrix.withProjectLock).toHaveBeenCalledWith('901', expect.any(Function))
    expect(env.repository.save).not.toHaveBeenCalled()
  })
  it('rejects a blank edited title before persistence', async () => {
    const env = makeUpdateEnvironment(null)
    await expect(env.service.updateProject(1, { title: ' ' })).rejects.toBeInstanceOf(BadRequestException)
    expect(env.repository.save).not.toHaveBeenCalled()
  })

  it('propagates a card resolution failure without writing contradictory company input', async () => {
    const env = makeUpdateEnvironment()
    env.bitrix.resolveProjectLink.mockRejectedValue(new BadRequestException('Card has no company'))
    await expect(env.service.updateProject(1, { clientCompany: 'Wrong' })).rejects.toThrow('Card has no company')
    expect(env.repository.save).not.toHaveBeenCalled()
    expect(env.project.clientCompany).toBe('Legacy company')
  })
})
