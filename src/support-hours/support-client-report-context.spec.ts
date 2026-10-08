import { BadRequestException, NotFoundException } from '@nestjs/common'
import { EntityTypeIds, ProjectCodes } from '../constants/const'
import { SupportHoursPackagesService } from './support-hours-packages.service'

function fixture() {
  const item = {
    id: 12, projectId: 27, purchaseDate: '2026-08-01',
    project: { id: 27, title: 'Cached support project', bitrixProjectId: '6', clientCompanyId: null },
  }
  const packages = { findOne: jest.fn().mockResolvedValue(item), save: jest.fn(), update: jest.fn() }
  const projects = { save: jest.fn(), update: jest.fn() }
  const reports = { save: jest.fn(), update: jest.fn() }
  const dataSource = { transaction: jest.fn(), query: jest.fn(), getRepository: jest.fn() }
  const bitrix = {
    getItem: jest.fn().mockResolvedValue({ id: '6', title: ' Current support project ', [ProjectCodes.company]: '665' }),
    getCompany: jest.fn().mockResolvedValue({ ID: '665', TITLE: ' Client company ' }),
    listAllItems: jest.fn(), updateItem: jest.fn(), addItem: jest.fn(),
  }
  const service = new SupportHoursPackagesService(projects as never, packages as never, reports as never, {} as never, dataSource as never, bitrix as never)
  const sync = jest.spyOn(service, 'sync')
  const syncProjects = jest.spyOn(service, 'syncSupportProjects')
  const snapshot = jest.spyOn(service, 'getReportSnapshot')
  const workspace = jest.spyOn(service, 'getProjectWorkspace')
  const expectReadOnly = () => {
    for (const method of [packages.save, packages.update, projects.save, projects.update, reports.save, reports.update,
      dataSource.transaction, dataSource.query, dataSource.getRepository, bitrix.listAllItems, bitrix.updateItem, bitrix.addItem,
      sync, syncProjects, snapshot, workspace]) expect(method).not.toHaveBeenCalled()
  }
  return { service, item, packages, bitrix, expectReadOnly }
}

describe('Read-only support package client report context', () => {
  it('resolves the authoritative company for an old project whose cache has no company ID', async () => {
    const f = fixture()

    await expect(f.service.getClientReportContext(12)).resolves.toEqual({
      packageId: 12, purchaseDate: '2026-08-01', projectId: 27, projectTitle: 'Current support project', bitrixProjectId: '6',
      companyId: 665, companyTitle: 'Client company',
    })

    expect(f.packages.findOne).toHaveBeenCalledWith({ where: { id: 12 }, relations: { project: true } })
    expect(f.bitrix.getItem).toHaveBeenCalledWith({ entityTypeId: EntityTypeIds.projects, id: 6 })
    expect(f.bitrix.getCompany).toHaveBeenCalledWith(665)
    f.expectReadOnly()
  })

  it('ignores a stale cached company and accepts standard numeric/lower-case CRM fields', async () => {
    const f = fixture()
    Object.assign(f.item.project, { clientCompanyId: '999' })
    f.bitrix.getItem.mockResolvedValue({ id: 6, [ProjectCodes.company]: 665 })
    f.bitrix.getCompany.mockResolvedValue({ id: 665, title: 'Client company' })

    await expect(f.service.getClientReportContext(12)).resolves.toMatchObject({
      projectTitle: 'Cached support project', companyId: 665, companyTitle: 'Client company',
    })

    expect(f.bitrix.getCompany).not.toHaveBeenCalledWith(999)
    f.expectReadOnly()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid package ID %s before any read', async (id) => {
    const f = fixture()
    await expect(f.service.getClientReportContext(id)).rejects.toBeInstanceOf(BadRequestException)
    expect(f.packages.findOne).not.toHaveBeenCalled()
    expect(f.bitrix.getItem).not.toHaveBeenCalled()
    f.expectReadOnly()
  })

  it('reports a missing package without querying CRM', async () => {
    const f = fixture()
    f.packages.findOne.mockResolvedValue(null)
    await expect(f.service.getClientReportContext(12)).rejects.toBeInstanceOf(NotFoundException)
    expect(f.bitrix.getItem).not.toHaveBeenCalled()
    f.expectReadOnly()
  })

  it.each([null, '', 'bad', '0', '-6', '6.5'])('rejects invalid cached project link %s', async (value) => {
    const f = fixture()
    Object.assign(f.item.project, { bitrixProjectId: value })
    await expect(f.service.getClientReportContext(12)).rejects.toThrow('нет корректной привязки')
    expect(f.bitrix.getItem).not.toHaveBeenCalled()
    f.expectReadOnly()
  })

  it('rejects an inconsistent local package/project relationship', async () => {
    const f = fixture()
    f.item.project.id = 99
    await expect(f.service.getClientReportContext(12)).rejects.toBeInstanceOf(BadRequestException)
    expect(f.bitrix.getItem).not.toHaveBeenCalled()
    f.expectReadOnly()
  })

  it.each([null, { id: 99, [ProjectCodes.company]: 665 }])('rejects a missing or mismatched source project', async (value) => {
    const f = fixture()
    f.bitrix.getItem.mockResolvedValue(value)
    await expect(f.service.getClientReportContext(12)).rejects.toThrow('связанный проект')
    expect(f.bitrix.getCompany).not.toHaveBeenCalled()
    f.expectReadOnly()
  })

  it.each([undefined, null, '', 0, -1, 'bad', [665]])('asks to fill in a valid project company when its value is %p', async (value) => {
    const f = fixture()
    f.bitrix.getItem.mockResolvedValue({ id: 6, [ProjectCodes.company]: value })
    await expect(f.service.getClientReportContext(12)).rejects.toThrow('укажите компанию клиента')
    expect(f.bitrix.getCompany).not.toHaveBeenCalled()
    f.expectReadOnly()
  })

  it.each([null, { ID: '999', TITLE: 'Another company' }, { TITLE: 'No ID' }])('rejects a missing or mismatched source company', async (value) => {
    const f = fixture()
    f.bitrix.getCompany.mockResolvedValue(value)
    await expect(f.service.getClientReportContext(12)).rejects.toThrow('найти компанию клиента')
    f.expectReadOnly()
  })

  it.each([undefined, null, '', '   ', 123])('rejects an invalid company title %p', async (value) => {
    const f = fixture()
    f.bitrix.getCompany.mockResolvedValue({ ID: '665', TITLE: value })
    await expect(f.service.getClientReportContext(12)).rejects.toThrow('укажите название клиента')
    f.expectReadOnly()
  })

  it('propagates a failed authoritative CRM read without falling back to cached ownership', async () => {
    const f = fixture()
    f.bitrix.getItem.mockRejectedValue(new Error('Upstream unavailable'))
    await expect(f.service.getClientReportContext(12)).rejects.toThrow('Upstream unavailable')
    expect(f.bitrix.getCompany).not.toHaveBeenCalled()
    f.expectReadOnly()
  })
})
