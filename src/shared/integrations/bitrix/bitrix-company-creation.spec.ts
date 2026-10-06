import { BadGatewayException } from '@nestjs/common'
import { of, throwError } from 'rxjs'
import { Endpoints } from '../../../constants/const'
import { BitrixCompanyCreateRejectedException, BitrixService } from './bitrix.service'

function fixture() {
  const http = { post: jest.fn() }
  return { http, service: new BitrixService(http as never) }
}

const fields = { TITLE: 'Acme', ORIGINATOR_ID: 'work-tracker', ORIGIN_ID: 'project:request' }
const listParams = { filter: { '=ORIGIN_ID': 'project:request' }, select: ['ID', 'TITLE', 'ORIGINATOR_ID', 'ORIGIN_ID'] }

describe('Bitrix company creation outcomes', () => {
  it.each([215, '215'])('reads the successful company ID %s and disables the social-network notification', async (result) => {
    const { http, service } = fixture()
    http.post.mockReturnValue(of({ data: { result } }))
    await expect(service.addCompany(fields)).resolves.toBe(215)
    expect(http.post).toHaveBeenCalledWith(Endpoints.companyAdd, { fields, params: { REGISTER_SONET_EVENT: 'N' } })
  })

  it.each(['ACCESS_DENIED', 'CRM_FIELD_ERROR_VALUE_NOT_VALID', 'INVALID_REQUEST'])('marks the documented rejection %s as definitive', async (error) => {
    const { http, service } = fixture()
    http.post.mockReturnValue(of({ data: { error, error_description: 'Private server details' } }))
    await expect(service.addCompany(fields)).rejects.toBeInstanceOf(BitrixCompanyCreateRejectedException)
  })

  it('marks a documented rejection in an HTTP error as definitive', async () => {
    const { http, service } = fixture()
    http.post.mockReturnValue(throwError(() => ({ response: { status: 400, data: { error: 'ACCESS_DENIED' } } })))
    await expect(service.addCompany(fields)).rejects.toBeInstanceOf(BitrixCompanyCreateRejectedException)
  })

  it.each([undefined, null, false, 0, -1, 1.5, '', 'not-id', {}, { id: 215 }, '9007199254740992'])('keeps an invalid successful result %j ambiguous', async (result) => {
    const { http, service } = fixture()
    http.post.mockReturnValue(of({ data: { result } }))
    await expect(service.addCompany(fields)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(service.addCompany(fields)).rejects.not.toBeInstanceOf(BitrixCompanyCreateRejectedException)
  })

  it.each(['', 'INTERNAL_SERVER_ERROR'])('detects an error property even with code %j and does not treat it as success', async (error) => {
    const { http, service } = fixture()
    http.post.mockReturnValue(of({ data: { error, error_description: 'Private server details', result: 215 } }))
    await expect(service.addCompany(fields)).rejects.toBeInstanceOf(BadGatewayException)
    await expect(service.addCompany(fields)).rejects.not.toBeInstanceOf(BitrixCompanyCreateRejectedException)
  })

  it('keeps a transport timeout ambiguous and sanitizes credentials from its message', async () => {
    const { http, service } = fixture()
    http.post.mockReturnValue(throwError(() => ({ message: 'Timeout at secret-token', config: { headers: { Authorization: 'secret-token' } } })))
    try {
      await service.addCompany(fields)
      throw new Error('Expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(BadGatewayException)
      expect(error).not.toBeInstanceOf(BitrixCompanyCreateRejectedException)
      expect(String(error)).not.toContain('secret-token')
    }
  })
})

describe('Bitrix company recovery list', () => {
  it('waits for all pages and uses the documented upper-case company fields', async () => {
    const { http, service } = fixture()
    http.post.mockReturnValueOnce(of({ data: { result: [{ ID: '1' }], next: 1, total: 2 } }))
      .mockReturnValueOnce(of({ data: { result: [{ ID: '2' }], total: 2 } }))
    await expect(service.listAllCompanies(listParams)).resolves.toEqual([{ ID: '1' }, { ID: '2' }])
    expect(http.post).toHaveBeenNthCalledWith(1, Endpoints.companyList, { ...listParams, order: { ID: 'ASC' }, start: 0 })
    expect(http.post).toHaveBeenNthCalledWith(2, Endpoints.companyList, { ...listParams, order: { ID: 'ASC' }, start: 1 })
  })

  it('allows an explicit empty successful list', async () => {
    const { http, service } = fixture()
    http.post.mockReturnValue(of({ data: { result: [], total: 0 } }))
    await expect(service.listAllCompanies(listParams)).resolves.toEqual([])
  })

  it.each([
    {}, { error: '', result: [] }, { error: 'ACCESS_DENIED' }, { result: null },
    { result: {} }, { result: [], total: 1 }, { result: [], total: -1 },
    { result: [], total: 'wrong' }, { result: [], next: 50 },
    { result: [{ ID: 1 }], next: 0 }, { result: [{ ID: 1 }], next: 1.5 },
  ])('rejects ambiguous, partial or erroneous list %j', async (data) => {
    const { http, service } = fixture()
    http.post.mockReturnValue(of({ data }))
    await expect(service.listAllCompanies(listParams)).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('refuses a repeated pagination cursor', async () => {
    const { http, service } = fixture()
    http.post.mockReturnValue(of({ data: { result: [{ ID: 1 }], next: 50 } }))
    await expect(service.listAllCompanies(listParams)).rejects.toBeInstanceOf(BadGatewayException)
    expect(http.post).toHaveBeenCalledTimes(2)
  })

  it('rejects a partially loaded list if a later page fails', async () => {
    const { http, service } = fixture()
    http.post.mockReturnValueOnce(of({ data: { result: [{ ID: 1 }], next: 1 } }))
      .mockReturnValueOnce(throwError(() => new Error('secret-token')))
    await expect(service.listAllCompanies(listParams)).rejects.toThrow('Не удалось проверить создание компании')
    expect(http.post).toHaveBeenCalledTimes(2)
  })
})
