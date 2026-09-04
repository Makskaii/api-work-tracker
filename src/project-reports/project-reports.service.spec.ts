import { ProjectReportsService } from './project-reports.service'
import { ReportProjectStatus } from './entities/project-report-project.entity'

const projects = [
  { id: 1, title: 'Alpha', projectStatus: ReportProjectStatus.InProgress, clientCompany: 'Acme', responsible: 'Alice', bitrixProjectId: null, projectStartDate: null, deadline: null, summaryPlanCompletionDate: null },
  { id: 2, title: 'Empty', projectStatus: ReportProjectStatus.NotStarted, clientCompany: 'Other', responsible: 'Bob', bitrixProjectId: null, projectStartDate: null, deadline: null, summaryPlanCompletionDate: null },
]

const makeService = (stages: unknown[], events: unknown[]) =>
  new ProjectReportsService(
    { find: jest.fn().mockResolvedValue(projects) } as never,
    {} as never,
    {
      find: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(stages.filter((stage) => (stage as { isGroup: boolean }).isGroup === where.isGroup)),
      ),
    } as never,
    { find: jest.fn().mockResolvedValue(events) } as never,
  )

describe('ProjectReportsService.findProjectsPlan', () => {
  const stages = [
    { id: 11, projectId: '1', title: 'Stage 11', isGroup: false, stageType: null, parentStageId: 10, sortOrder: 1 },
    { id: 12, projectId: '1', title: 'Stage 12', isGroup: false, stageType: null, parentStageId: 2, sortOrder: 1 },
    { id: 13, projectId: '1', title: 'Stage 13', isGroup: false, stageType: null, parentStageId: null, sortOrder: 1 },
    { id: 10, projectId: '1', title: 'Group', isGroup: true, parentStageId: null, sortOrder: 0 },
  ]

  it('aggregates dates and excludes groups', async () => {
    const [result] = await makeService(stages, [
      { id: 20, projectId: '1', stageId: 11, title: 'Event', planStartDate: '2026-01-02', planEndDate: '2026-01-05', factStartDate: '2026-01-03', factEndDate: '2026-01-06' },
    ]).findProjectsPlan({})
    expect(result.stages.map((stage) => stage.id)).toEqual([13, 12, 11])
    expect(result.planStartDate).toBe('2026-01-02')
    expect(result.factEndDate).toBe('2026-01-06')
  })

  it('filters by search and status', async () => {
    const service = makeService([], [])
    expect((await service.findProjectsPlan({ search: 'acme' })).map((p) => p.id)).toEqual([1])
    expect((await service.findProjectsPlan({ status: ReportProjectStatus.NotStarted })).map((p) => p.id)).toEqual([2])
  })

  it('excludes projects without planned dates when a period is provided', async () => {
    const result = await makeService([], []).findProjectsPlan({ from: '2026-01-01' })
    expect(result.map((project) => project.id)).toEqual([])
  })

  it('returns projects without stages when no period filter is provided', async () => {
    const result = await makeService([], []).findProjectsPlan({})
    expect(result.find((project) => project.id === 2)).toEqual(expect.objectContaining({ stages: [], planStartDate: null, planEndDate: null }))
  })
})
