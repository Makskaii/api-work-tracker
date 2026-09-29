import { ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { SupportHoursConsumption } from './entities/support-hours-consumption.entity'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursPackagesService } from './support-hours-packages.service'

function fixture() {
  const project = { id: 1, projectType: ReportProjectType.Support }
  let state = {
    packages: [
      { id: 1, projectId: 1, purchasedHours: 10, purchaseDate: '2026-09-01', comment: 'Keep this comment', amount: null },
      { id: 2, projectId: 1, purchasedHours: 10, purchaseDate: '2026-09-15', comment: null as string | null, amount: null },
    ],
    reports: [{ id: 1, projectId: 1, hours: 12, reportDate: new Date('2026-09-10') }],
    consumptions: [{ reportId: 1, packageId: 1, hours: 10 }, { reportId: 1, packageId: 2, hours: 2 }],
  }
  let activeTransaction = false
  const assertTransaction = () => { expect(activeTransaction).toBe(true) }
  const packageRepository = {
    create: jest.fn((value) => { assertTransaction(); return { id: 3, ...value } }),
    findOne: jest.fn(({ where }) => { assertTransaction(); return Promise.resolve(structuredClone(state.packages.find((item) => item.id === where.id))) }),
    find: jest.fn(({ where }) => { assertTransaction(); return Promise.resolve(structuredClone(state.packages.filter((item) => item.projectId === where.projectId).sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id - b.id))) }),
    save: jest.fn((item) => {
      assertTransaction()
      const index = state.packages.findIndex((candidate) => candidate.id === item.id)
      if (index < 0) state.packages.push(structuredClone(item))
      else state.packages[index] = structuredClone(item)
      return Promise.resolve(item)
    }),
    remove: jest.fn((item) => {
      assertTransaction()
      state.packages = state.packages.filter((candidate) => candidate.id !== item.id)
      state.consumptions = state.consumptions.filter((row) => row.packageId !== item.id)
      return Promise.resolve(item)
    }),
  }
  const consumptionRepository = {
    create: jest.fn((value) => { assertTransaction(); return value }),
    delete: jest.fn(({ packageId }) => { assertTransaction(); state.consumptions = state.consumptions.filter((row) => !packageId.value.includes(row.packageId)); return Promise.resolve({}) }),
    save: jest.fn(() => { assertTransaction(); return Promise.reject(new Error('allocation write failed')) }),
  }
  const reportRepository = { find: jest.fn(() => { assertTransaction(); return Promise.resolve(structuredClone(state.reports)) }) }
  const manager = { getRepository: (entity: unknown) => {
    if (entity === SupportHoursPackage) return packageRepository
    if (entity === SupportHoursReport) return reportRepository
    if (entity === SupportHoursConsumption) return consumptionRepository
    throw new Error('Unexpected repository')
  } }
  const dataSource = { transaction: jest.fn(async (operation) => {
    const before = structuredClone(state)
    activeTransaction = true
    try {
      return await operation(manager)
    } catch (error) {
      state = before
      throw error
    } finally {
      activeTransaction = false
    }
  }) }
  const projects = { findOne: jest.fn().mockResolvedValue(project) }
  const service = new SupportHoursPackagesService(projects as never, packageRepository as never, reportRepository as never,
    consumptionRepository as never, dataSource as never, {} as never)
  return { service, dataSource, packageRepository, consumptionRepository, snapshot: () => structuredClone(state) }
}

describe('Atomic support package mutations', () => {
  it.each(['create', 'update', 'delete'] as const)('rolls back package %s and every existing allocation when reallocation fails', async (operation) => {
    const context = fixture()
    const before = context.snapshot()
    const mutation = operation === 'create'
      ? context.service.create({ projectId: 1, purchasedHours: 8, purchaseDate: '2026-08-01' })
      : operation === 'update'
        ? context.service.update(1, { purchasedHours: 7, comment: '' })
        : context.service.remove(1)
    await expect(mutation).rejects.toThrow('allocation write failed')
    expect(context.dataSource.transaction).toHaveBeenCalledTimes(1)
    expect(context.consumptionRepository.delete).toHaveBeenCalledTimes(1)
    expect(context.snapshot()).toEqual(before)
  })
})
