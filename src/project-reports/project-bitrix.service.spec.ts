import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { EntityTypeIds, FinancialProjectType, ProjectCodes } from '../constants/const'
import { BitrixItemCreateRejectedException } from '../shared/integrations/bitrix/bitrix.service'
import { ReportProject, ReportProjectType } from './entities/project-report-project.entity'
import { ProjectBitrixService } from './project-bitrix.service'

const REQUEST_ID = '01a110ba-c8de-4de0-96b7-aef6a762b340'
const sourceProject = {
  id: 901, title: 'New project', xmlId: `work-tracker:${REQUEST_ID}`,
  [ProjectCodes.company]: '215',
}
const createDto = {
  title: '  New project  ', clientCompanyId: '215', clientCompany: 'User supplied text',
  projectGoal: '  Build a useful product  ', projectType: ReportProjectType.Waterfall,
  responsibleId: '27', creationRequestId: REQUEST_ID,
}

function makeEnvironment() {
  const stored: ReportProject[] = []
  const attempts = new Map<string, { project_title: string; company_id: string }>()
  const repository = {
    create: jest.fn(() => ({ files: [] }) as unknown as ReportProject),
    findOne: jest.fn(({ where }: { where: Partial<ReportProject> }) => Promise.resolve(
      stored.find((project) => Object.entries(where).every(([key, value]) => project[key as keyof ReportProject] === value)) ?? null)),
    save: jest.fn((project: ReportProject) => {
      project.id ||= stored.length + 1
      if (!stored.includes(project)) stored.push(project)
      return Promise.resolve(project)
    }),
  }
  const runner = {
    isTransactionActive: false,
    manager: { getRepository: jest.fn(() => repository) },
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn(() => { runner.isTransactionActive = true; return Promise.resolve() }),
    commitTransaction: jest.fn(() => { runner.isTransactionActive = false; return Promise.resolve() }),
    rollbackTransaction: jest.fn(() => { runner.isTransactionActive = false; return Promise.resolve() }),
    query: jest.fn((sql: string, parameters: string[]) => {
      if (sql.includes('GET_LOCK')) return Promise.resolve([{ acquired: 1 }])
      if (sql.includes('RELEASE_LOCK')) return Promise.resolve([{ released: 1 }])
      if (sql.startsWith('SELECT project_title')) return Promise.resolve(attempts.has(parameters[0]) ? [attempts.get(parameters[0])] : [])
      if (sql.startsWith('INSERT INTO project_report_creation_requests')) {
        attempts.set(parameters[0], { project_title: parameters[1], company_id: parameters[2] })
        return Promise.resolve([])
      }
      if (sql.startsWith('DELETE FROM project_report_creation_requests')) {
        attempts.delete(parameters[0])
        return Promise.resolve([])
      }
      return Promise.reject(new Error('Unexpected database query'))
    }),
  }
  const bitrix = {
    getCompany: jest.fn().mockResolvedValue({ ID: '215', TITLE: 'Acme' }),
    getItem: jest.fn().mockResolvedValue(sourceProject),
    listAllItems: jest.fn().mockResolvedValue([]),
    addItem: jest.fn().mockResolvedValue(sourceProject),
  }
  const dataSource = { createQueryRunner: jest.fn(() => runner) }
  return { service: new ProjectBitrixService(bitrix as never, dataSource as never), repository, runner, bitrix, attempts, stored, dataSource }
}

describe('ProjectBitrixService.createProject', () => {
  it('creates a smart-process project with company, goal, type and responsible, then saves its real link', async () => {
    const env = makeEnvironment()
    const project = await env.service.createProject(createDto)
    expect(env.bitrix.addItem).toHaveBeenCalledWith({
      entityTypeId: EntityTypeIds.projects,
      fields: {
        title: 'New project', xmlId: `work-tracker:${REQUEST_ID}`,
        [ProjectCodes.company]: 215, [ProjectCodes.goal]: 'Build a useful product',
        [ProjectCodes.financialProjectType]: FinancialProjectType.Waterfall,
        [ProjectCodes.assignedBy]: 27,
      },
    })
    expect(project).toMatchObject({ title: 'New project', bitrixProjectId: '901', clientCompanyId: '215', clientCompany: 'Acme', creationRequestId: REQUEST_ID })
    const journalCall = env.runner.query.mock.calls.findIndex(([sql]) => sql.startsWith('INSERT INTO'))
    expect(env.runner.query.mock.invocationCallOrder[journalCall]).toBeLessThan(env.bitrix.addItem.mock.invocationCallOrder[0])
    expect(env.runner.commitTransaction).toHaveBeenCalledTimes(1)
    expect(env.runner.release).toHaveBeenCalledTimes(1)
  })

  it('takes the company from an existing selected card and ignores contradictory input', async () => {
    const env = makeEnvironment()
    const project = await env.service.createProject({ ...createDto, bitrixProjectId: '901', clientCompanyId: '999', clientCompany: 'Wrong', projectGoal: null })
    expect(project.clientCompanyId).toBe('215')
    expect(project.clientCompany).toBe('Acme')
    expect(env.bitrix.getCompany).toHaveBeenCalledWith(215)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    expect(env.attempts.size).toBe(0)
  })

  it('returns a completed request on retry without repeating any Bitrix calls', async () => {
    const env = makeEnvironment()
    const first = await env.service.createProject(createDto)
    const second = await env.service.createProject(createDto)
    expect(second.id).toBe(first.id)
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(1)
    expect(env.bitrix.listAllItems).toHaveBeenCalledTimes(1)
    expect(env.stored).toHaveLength(1)
  })

  it('recovers the same card after a database save failure instead of creating another card', async () => {
    const env = makeEnvironment()
    env.repository.save.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(env.service.createProject(createDto)).rejects.toThrow('Database unavailable')
    expect(env.runner.rollbackTransaction).toHaveBeenCalledTimes(1)
    env.bitrix.listAllItems.mockResolvedValue([sourceProject])
    const recovered = await env.service.createProject(createDto)
    expect(recovered.bitrixProjectId).toBe('901')
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(1)
    expect(env.stored).toHaveLength(1)
  })

  it('recovers by xmlId when a remote creation reply was lost', async () => {
    const env = makeEnvironment()
    env.bitrix.addItem.mockRejectedValueOnce(new BadGatewayException('Transport timeout'))
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(BadGatewayException)
    env.bitrix.listAllItems.mockResolvedValue([sourceProject])
    await expect(env.service.createProject(createDto)).resolves.toMatchObject({ bitrixProjectId: '901' })
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(1)
  })

  it('never repeats an add when an earlier remote result remains unknown', async () => {
    const env = makeEnvironment()
    env.bitrix.addItem.mockRejectedValueOnce(new BadGatewayException('Transport timeout'))
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(ConflictException)
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(1)
    expect(env.repository.save).not.toHaveBeenCalled()
    expect(env.attempts.size).toBe(1)
  })

  it('allows corrected retry after a definitive validation rejection', async () => {
    const env = makeEnvironment()
    env.bitrix.addItem.mockRejectedValueOnce(new BitrixItemCreateRejectedException())
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(BitrixItemCreateRejectedException)
    expect(env.attempts.size).toBe(0)
    await expect(env.service.createProject({ ...createDto, projectGoal: 'Corrected goal' })).resolves.toMatchObject({ bitrixProjectId: '901' })
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(2)
  })

  it('rejects linking a smart project that already has a Work Tracker project', async () => {
    const env = makeEnvironment()
    env.stored.push({ id: 7, bitrixProjectId: '901', creationRequestId: null } as ReportProject)
    await expect(env.service.createProject({ ...createDto, bitrixProjectId: '901' })).rejects.toBeInstanceOf(ConflictException)
    expect(env.repository.save).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('adopts a locally discovered catalogue row rather than duplicating the newly created card', async () => {
    const env = makeEnvironment()
    const catalogueProject = { id: 9, bitrixProjectId: '901', creationRequestId: null, summaryFactHours: 12 } as ReportProject
    env.stored.push(catalogueProject)
    const result = await env.service.createProject(createDto)
    expect(result.id).toBe(9)
    expect(result.summaryFactHours).toBe(12)
    expect(env.stored).toHaveLength(1)
  })

  it.each(['', ' ', '0', '-1', 'abc', '9007199254740992'])('rejects an invalid selected project ID %s before remote writes', async (id) => {
    const env = makeEnvironment()
    if (id === '' || id === ' ') {
      await expect(env.service.createProject({ ...createDto, bitrixProjectId: id, clientCompanyId: undefined })).rejects.toBeInstanceOf(BadRequestException)
    } else {
      await expect(env.service.createProject({ ...createDto, bitrixProjectId: id })).rejects.toBeInstanceOf(BadRequestException)
    }
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    expect(env.repository.save).not.toHaveBeenCalled()
  })

  it('rejects a blank title before connecting to the database', async () => {
    const env = makeEnvironment()
    await expect(env.service.createProject({ ...createDto, title: ' ' })).rejects.toBeInstanceOf(BadRequestException)
    expect(env.dataSource.createQueryRunner).not.toHaveBeenCalled()
  })

  it('rejects a missing company before reserving a remote attempt', async () => {
    const env = makeEnvironment()
    await expect(env.service.createProject({ ...createDto, clientCompanyId: undefined })).rejects.toBeInstanceOf(BadRequestException)
    expect(env.attempts.size).toBe(0)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('rejects a missing real company before creating a card', async () => {
    const env = makeEnvironment()
    env.bitrix.getCompany.mockResolvedValue(null)
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(NotFoundException)
    expect(env.attempts.size).toBe(0)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('requires the configured goal before any remote attempt', async () => {
    const env = makeEnvironment()
    await expect(env.service.createProject({ ...createDto, projectGoal: ' ' })).rejects.toBeInstanceOf(BadRequestException)
    expect(env.bitrix.getCompany).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    expect(env.attempts.size).toBe(0)
  })

  it('rejects an existing card without a company', async () => {
    const env = makeEnvironment()
    env.bitrix.getItem.mockResolvedValue({ ...sourceProject, [ProjectCodes.company]: null })
    await expect(env.service.createProject({ ...createDto, bitrixProjectId: '901' })).rejects.toBeInstanceOf(BadRequestException)
    expect(env.repository.save).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('rejects a missing selected card without creating a replacement', async () => {
    const env = makeEnvironment()
    env.bitrix.getItem.mockResolvedValue(null)
    await expect(env.service.createProject({ ...createDto, bitrixProjectId: '901' })).rejects.toBeInstanceOf(NotFoundException)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('requires a client-stable request ID for automatic creation', async () => {
    const env = makeEnvironment()
    await expect(env.service.createProject({ ...createDto, creationRequestId: undefined })).rejects.toBeInstanceOf(BadRequestException)
    expect(env.dataSource.createQueryRunner).not.toHaveBeenCalled()
  })

  it('rejects mismatched recovery instead of saving a wrong company', async () => {
    const env = makeEnvironment()
    env.bitrix.listAllItems.mockResolvedValue([{ ...sourceProject, xmlId: 'other-marker' }])
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(BadGatewayException)
    expect(env.repository.save).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('does not reserve an attempt when another operation holds the request lock', async () => {
    const env = makeEnvironment()
    env.runner.query.mockResolvedValue([{ acquired: 0 }])
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(ConflictException)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    expect(env.runner.release).toHaveBeenCalled()
  })
})
