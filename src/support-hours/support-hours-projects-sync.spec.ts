import { ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { SupportHoursPackagesService } from './support-hours-packages.service'

describe('SupportHoursPackagesService project sync', () => {
  it('adds a Bitrix support project once and does not duplicate it on the next sync', async () => {
    const projects: Array<{ id: number; bitrixProjectId: string; title: string; projectType: ReportProjectType }> = []
    const projectsRepository = {
      create: jest.fn((project) => project),
      findOne: jest.fn(({ where }) => Promise.resolve(projects.find((project) => project.bitrixProjectId === where.bitrixProjectId) ?? null)),
      save: jest.fn((project) => {
        const existingIndex = projects.findIndex((item) => item.bitrixProjectId === project.bitrixProjectId)
        const saved = { id: existingIndex === -1 ? projects.length + 1 : projects[existingIndex].id, ...project }
        if (existingIndex === -1) projects.push(saved)
        else projects[existingIndex] = saved
        return Promise.resolve(saved)
      }),
    }
    const bitrixService = {
      listAllItems: jest.fn().mockResolvedValue([{ id: '42', title: 'Техподдержка клиента', ufCrm20_1781683772: '410' }]),
    }
    const service = new SupportHoursPackagesService(
      projectsRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      bitrixService as never,
    )

    await service.syncSupportProjects()
    const serviceState = service as unknown as { supportProjectsLastSyncAt: number }
    serviceState.supportProjectsLastSyncAt = 0
    await service.syncSupportProjects()

    expect(projects).toEqual([{ id: 1, bitrixProjectId: '42', title: 'Техподдержка клиента', projectType: ReportProjectType.Support }])
    expect(bitrixService.listAllItems).toHaveBeenCalledTimes(2)
  })
})
