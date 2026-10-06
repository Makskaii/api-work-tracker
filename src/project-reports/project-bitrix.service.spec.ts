import { BadGatewayException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { EntityTypeIds, FinancialProjectType, ProjectCodes } from '../constants/const'
import { BitrixCompanyCreateRejectedException, BitrixItemCreateRejectedException } from '../shared/integrations/bitrix/bitrix.service'
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
  const companyAttempts = new Map<string, { project_title: string; company_title: string; company_id: string | null }>()
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
    query: jest.fn((sql: string, parameters: Array<string | null>) => {
      if (sql.includes('GET_LOCK')) return Promise.resolve([{ acquired: 1 }])
      if (sql.includes('RELEASE_LOCK')) return Promise.resolve([{ released: 1 }])
      if (sql.startsWith('SELECT project_title, company_title')) return Promise.resolve(companyAttempts.has(String(parameters[0])) ? [companyAttempts.get(String(parameters[0]))] : [])
      if (sql.startsWith('SELECT project_title')) return Promise.resolve(attempts.has(String(parameters[0])) ? [attempts.get(String(parameters[0]))] : [])
      if (sql.startsWith('INSERT INTO project_report_company_creation_requests')) {
        companyAttempts.set(String(parameters[0]), { project_title: String(parameters[1]), company_title: String(parameters[2]), company_id: parameters[3] })
        return Promise.resolve([])
      }
      if (sql.startsWith('UPDATE project_report_company_creation_requests')) {
        const attempt = companyAttempts.get(String(parameters[1]))
        if (attempt) attempt.company_id = parameters[0]
        return Promise.resolve([])
      }
      if (sql.startsWith('DELETE FROM project_report_company_creation_requests')) {
        companyAttempts.delete(String(parameters[0]))
        return Promise.resolve([])
      }
      if (sql.startsWith('INSERT INTO project_report_creation_requests')) {
        attempts.set(String(parameters[0]), { project_title: String(parameters[1]), company_id: String(parameters[2]) })
        return Promise.resolve([])
      }
      if (sql.startsWith('DELETE FROM project_report_creation_requests')) {
        attempts.delete(String(parameters[0]))
        return Promise.resolve([])
      }
      return Promise.reject(new Error('Unexpected database query'))
    }),
  }
  const bitrix = {
    getCompany: jest.fn().mockResolvedValue({ ID: '215', TITLE: 'Acme', ORIGINATOR_ID: 'work-tracker', ORIGIN_ID: `project:${REQUEST_ID}` }),
    getItem: jest.fn().mockResolvedValue(sourceProject),
    listAllItems: jest.fn().mockResolvedValue([]),
    addItem: jest.fn().mockResolvedValue(sourceProject),
    addCompany: jest.fn().mockResolvedValue(215),
    listAllCompanies: jest.fn().mockResolvedValue([]),
  }
  const dataSource = { createQueryRunner: jest.fn(() => runner) }
  return { service: new ProjectBitrixService(bitrix as never, dataSource as never), repository, runner, bitrix, attempts, companyAttempts, stored, dataSource }
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

const newCompanyDto = { ...createDto, clientCompanyId: null, clientCompany: null, newCompanyTitle: '  Acme  ' }
const recoveredCompany = { ID: '215', TITLE: 'Acme', ORIGINATOR_ID: 'work-tracker', ORIGIN_ID: `project:${REQUEST_ID}` }

describe('ProjectBitrixService company creation', () => {
  it('creates the selected new company before its project and excludes creation-only input from the response', async () => {
    const env = makeEnvironment()
    const project = await env.service.createProject(newCompanyDto)
    expect(env.bitrix.addCompany).toHaveBeenCalledWith({ TITLE: 'Acme', ORIGINATOR_ID: 'work-tracker', ORIGIN_ID: `project:${REQUEST_ID}` })
    expect(env.bitrix.listAllCompanies).toHaveBeenCalledWith({
      filter: { '=ORIGINATOR_ID': 'work-tracker', '=ORIGIN_ID': `project:${REQUEST_ID}` },
      select: ['ID', 'TITLE', 'ORIGINATOR_ID', 'ORIGIN_ID'],
    })
    expect(env.bitrix.addCompany.mock.invocationCallOrder[0]).toBeLessThan(env.bitrix.addItem.mock.invocationCallOrder[0])
    const reservation = env.runner.query.mock.calls.findIndex(([sql]) => sql.startsWith('INSERT INTO project_report_company'))
    expect(env.runner.query.mock.invocationCallOrder[reservation]).toBeLessThan(env.bitrix.addCompany.mock.invocationCallOrder[0])
    expect(project).toMatchObject({ clientCompanyId: '215', clientCompany: 'Acme', bitrixProjectId: '901' })
    expect(project).not.toHaveProperty('newCompanyTitle')
    expect(env.companyAttempts.get(REQUEST_ID)?.company_id).toBe('215')
  })

  it.each([
    { clientCompanyId: '215' }, { bitrixProjectId: '901' }, { newCompanyTitle: '' },
    { newCompanyTitle: ' ' }, { newCompanyTitle: 'x'.repeat(256) }, { projectGoal: ' ' },
    { responsibleId: 'wrong' },
  ])('rejects invalid company choice or project input before CRM side effects: %j', async (change) => {
    const env = makeEnvironment()
    await expect(env.service.createProject({ ...newCompanyDto, ...change })).rejects.toBeInstanceOf(BadRequestException)
    expect(env.bitrix.addCompany).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('never creates a company in existing-company mode', async () => {
    const env = makeEnvironment()
    await env.service.createProject(createDto)
    expect(env.bitrix.addCompany).not.toHaveBeenCalled()
    expect(env.bitrix.listAllCompanies).not.toHaveBeenCalled()
    expect(env.companyAttempts.size).toBe(0)
  })

  it('recovers a lost company reply after process restart using durable markers', async () => {
    const env = makeEnvironment()
    env.bitrix.addCompany.mockRejectedValueOnce(new BadGatewayException('Transport timeout'))
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(BadGatewayException)
    expect(env.companyAttempts.get(REQUEST_ID)?.company_id).toBeNull()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    env.bitrix.listAllCompanies.mockResolvedValue([recoveredCompany])
    const restarted = new ProjectBitrixService(env.bitrix as never, env.dataSource as never)
    await expect(restarted.createProject(newCompanyDto)).resolves.toMatchObject({ clientCompanyId: '215' })
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
  })

  it('keeps an uncertain company attempt and refuses a duplicate add while recovery is empty', async () => {
    const env = makeEnvironment()
    env.bitrix.addCompany.mockRejectedValueOnce(new BadGatewayException('Transport timeout'))
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(ConflictException)
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    expect(env.companyAttempts.size).toBe(1)
  })

  it('permits a retry after a documented company creation rejection', async () => {
    const env = makeEnvironment()
    env.bitrix.addCompany.mockRejectedValueOnce(new BitrixCompanyCreateRejectedException())
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(BitrixCompanyCreateRejectedException)
    expect(env.companyAttempts.size).toBe(0)
    await expect(env.service.createProject(newCompanyDto)).resolves.toMatchObject({ clientCompanyId: '215' })
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(2)
  })

  it('retains the created company after a definitive project rejection and reuses it on corrected retry', async () => {
    const env = makeEnvironment()
    env.bitrix.addItem.mockRejectedValueOnce(new BitrixItemCreateRejectedException())
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(BitrixItemCreateRejectedException)
    expect(env.companyAttempts.get(REQUEST_ID)?.company_id).toBe('215')
    expect(env.attempts.size).toBe(0)
    env.bitrix.listAllCompanies.mockResolvedValue([recoveredCompany])
    await expect(env.service.createProject({ ...newCompanyDto, projectGoal: 'Corrected goal' })).resolves.toMatchObject({ clientCompanyId: '215' })
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(2)
  })

  it('retains company and project journals on local save failure and recovers without a second remote add', async () => {
    const env = makeEnvironment()
    env.repository.save.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(env.service.createProject(newCompanyDto)).rejects.toThrow('Database unavailable')
    env.bitrix.listAllCompanies.mockResolvedValue([recoveredCompany])
    env.bitrix.listAllItems.mockResolvedValue([sourceProject])
    await expect(env.service.createProject(newCompanyDto)).resolves.toMatchObject({ clientCompanyId: '215' })
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(1)
  })

  it('journals a valid recovered project even when its original local journal is missing, so identical retries remain idempotent', async () => {
    const env = makeEnvironment()
    env.bitrix.listAllItems.mockResolvedValue([sourceProject])
    const first = await env.service.createProject(createDto)
    const repeated = await env.service.createProject(createDto)
    expect(first.id).toBe(repeated.id)
    expect(env.attempts.get(REQUEST_ID)).toEqual({ project_title: 'New project', company_id: '215' })
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    expect(env.bitrix.listAllItems).toHaveBeenCalledTimes(1)
    expect(env.stored).toHaveLength(1)
  })

  it('retains recovery protection if recording a confirmed company ID fails', async () => {
    const env = makeEnvironment()
    const normalQuery = env.runner.query.getMockImplementation()!
    let failOnce = true
    env.runner.query.mockImplementation((sql, parameters) => {
      if (sql.startsWith('UPDATE project_report_company') && failOnce) {
        failOnce = false
        return Promise.reject(new Error('Journal unavailable'))
      }
      return normalQuery(sql, parameters)
    })
    await expect(env.service.createProject(newCompanyDto)).rejects.toThrow('Journal unavailable')
    env.bitrix.listAllCompanies.mockResolvedValue([recoveredCompany])
    await expect(env.service.createProject(newCompanyDto)).resolves.toMatchObject({ clientCompanyId: '215' })
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
  })

  it.each([
    { newCompanyTitle: 'Different' }, { title: 'Another project' },
    { newCompanyTitle: undefined, clientCompanyId: '215' },
    { newCompanyTitle: undefined, bitrixProjectId: '901' },
  ])('rejects changing a durable request after an uncertain company result: %j', async (change) => {
    const env = makeEnvironment()
    env.bitrix.addCompany.mockRejectedValueOnce(new BadGatewayException('Transport timeout'))
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(env.service.createProject({ ...newCompanyDto, ...change })).rejects.toBeInstanceOf(ConflictException)
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('rejects changing an existing-company attempt into company creation', async () => {
    const env = makeEnvironment()
    env.bitrix.addItem.mockRejectedValueOnce(new BadGatewayException('Transport timeout'))
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(ConflictException)
    expect(env.bitrix.addCompany).not.toHaveBeenCalled()
  })

  it('validates company choice even on the completed-request shortcut', async () => {
    const env = makeEnvironment()
    await env.service.createProject(newCompanyDto)
    await expect(env.service.createProject({ ...newCompanyDto, newCompanyTitle: 'Different' })).rejects.toBeInstanceOf(ConflictException)
    await expect(env.service.createProject(createDto)).rejects.toBeInstanceOf(ConflictException)
    await expect(env.service.createProject({ ...newCompanyDto, clientCompanyId: '215' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(env.service.createProject(newCompanyDto)).resolves.toMatchObject({ clientCompanyId: '215' })
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
    expect(env.bitrix.listAllCompanies).toHaveBeenCalledTimes(1)
  })

  it.each([
    { items: [{ ...recoveredCompany, ORIGIN_ID: 'wrong' }] },
    { items: [{ ...recoveredCompany, ORIGINATOR_ID: 'other' }] },
    { items: [recoveredCompany, recoveredCompany] },
    { items: [null] },
  ])('rejects incorrect or duplicated recovery markers without creating a replacement', async ({ items }) => {
    const env = makeEnvironment()
    env.bitrix.listAllCompanies.mockResolvedValue(items)
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(BadGatewayException)
    expect(env.bitrix.addCompany).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('rejects a recovered company whose title was manually changed', async () => {
    const env = makeEnvironment()
    env.bitrix.listAllCompanies.mockResolvedValue([recoveredCompany])
    env.bitrix.getCompany.mockResolvedValue({ ...recoveredCompany, TITLE: 'Changed' })
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(ConflictException)
    expect(env.bitrix.addCompany).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('refuses project creation when a fresh company response omitted its recovery markers', async () => {
    const env = makeEnvironment()
    env.bitrix.getCompany.mockResolvedValue({ ID: '215', TITLE: 'Acme' })
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(BadGatewayException)
    expect(env.companyAttempts.get(REQUEST_ID)?.company_id).toBe('215')
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('serializes overlapping requests while the first CRM company call is pending', async () => {
    const env = makeEnvironment()
    const query = env.runner.query.getMockImplementation()!
    const held = new Set<string>()
    env.runner.query.mockImplementation((sql, parameters) => {
      const lock = String(parameters[0])
      if (sql.includes('GET_LOCK')) {
        if (held.has(lock)) return Promise.resolve([{ acquired: 0 }])
        held.add(lock)
        return Promise.resolve([{ acquired: 1 }])
      }
      if (sql.includes('RELEASE_LOCK')) held.delete(lock)
      return query(sql, parameters)
    })
    let releaseCompany!: (id: number) => void
    let signalCompanyStarted!: () => void
    const started = new Promise<void>((resolve) => { signalCompanyStarted = resolve })
    env.bitrix.addCompany.mockImplementationOnce(() => new Promise<number>((resolve) => {
      releaseCompany = resolve
      signalCompanyStarted()
    }))
    const first = env.service.createProject(newCompanyDto)
    await started
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(ConflictException)
    releaseCompany(215)
    await expect(first).resolves.toMatchObject({ clientCompanyId: '215' })
    expect(env.bitrix.addCompany).toHaveBeenCalledTimes(1)
    expect(env.bitrix.addItem).toHaveBeenCalledTimes(1)
    expect(held.size).toBe(0)
  })

  it('holds the same request lock around company and project writes and rejects concurrent creation', async () => {
    const env = makeEnvironment()
    env.runner.query.mockResolvedValue([{ acquired: 0 }])
    await expect(env.service.createProject(newCompanyDto)).rejects.toBeInstanceOf(ConflictException)
    expect(env.runner.query).toHaveBeenCalledWith('SELECT GET_LOCK(?, 5) AS acquired', [`work-tracker:project:${REQUEST_ID}`])
    expect(env.bitrix.addCompany).not.toHaveBeenCalled()
    expect(env.bitrix.addItem).not.toHaveBeenCalled()
    expect(env.runner.release).toHaveBeenCalled()
  })
})
