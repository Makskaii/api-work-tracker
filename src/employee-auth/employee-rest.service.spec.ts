import { BadGatewayException, BadRequestException, ForbiddenException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { assertEmployeeRestPermission, EmployeeRestService } from './employee-rest.service'
import { EmployeeAuthService, type ResolvedEmployeeSession } from './employee-auth.service'

const identity = (rules = [{ action: 'read', subject: 'post' }]): ResolvedEmployeeSession => ({
  identity: { user: { id: 42, name: 'Test', departmentIds: [23], isAdmin: false }, rules, portalOrigin: 'https://portal.example.test' },
  accessToken: 'per-user-token', csrfToken: 'csrf', sessionId: 'opaque', expiresAt: Date.now() + 60_000,
})

describe('authenticated Bitrix proxy', () => {
  const staff = identity()
  const sales = identity([{ action: 'read', subject: 'sales-report' }, { action: 'create-client', subject: 'client' }])
  const mockAuth = { callRest: jest.fn() }
  const proxy = new EmployeeRestService(mockAuth as unknown as EmployeeAuthService, new ConfigService({ API_URL: 'https://portal.example.test/rest/3/server-credential/' }))
  const originalFetch = global.fetch
  const fetchMock = jest.fn()
  beforeEach(() => { jest.clearAllMocks(); global.fetch = fetchMock; fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ result: { items: [] }, next: 50, total: 123 }) }) })
  afterAll(() => { global.fetch = originalFetch })

  it('retains report pagination without exposing the server integration credential', async () => {
    const result = await proxy.call(staff, 'crm.item.list', { entityTypeId: 1072, start: 0 })
    expect(result).toEqual({ result: { items: [] }, next: 50, total: 123 })
    expect(JSON.stringify(result)).not.toContain('server-credential')
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://portal.example.test/rest/3/server-credential/crm.item.list.json'), expect.objectContaining({ redirect: 'manual', body: JSON.stringify({ entityTypeId: 1072, start: 0 }) }))
  })
  it('uses employee OAuth for writes rather than the privileged read integration', async () => {
    mockAuth.callRest.mockResolvedValue({ result: { item: { id: 5430 } } })
    await expect(proxy.call(staff, 'crm.item.add', { entityTypeId: 1060, fields: { title: 'Work' } })).resolves.toEqual({ result: { item: { id: 5430 } } })
    expect(mockAuth.callRest).toHaveBeenCalledWith(staff, 'crm.item.add', expect.any(Object))
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('limits sales to sales data and company lookup', () => {
    expect(() => assertEmployeeRestPermission(sales, 'crm.item.list', { entityTypeId: 2 })).not.toThrow()
    expect(() => assertEmployeeRestPermission(sales, 'crm.item.list', { entityTypeId: 4 })).not.toThrow()
    expect(() => assertEmployeeRestPermission(sales, 'voximplant.statistic.get', {})).not.toThrow()
    for (const entityTypeId of [1072, 1060, 1092, 1144]) expect(() => assertEmployeeRestPermission(sales, 'crm.item.list', { entityTypeId })).toThrow(ForbiddenException)
    expect(() => assertEmployeeRestPermission(sales, 'crm.item.update', { entityTypeId: 1060 })).toThrow(ForbiddenException)
  })
  it('does not turn the proxy into an arbitrary URL/method executor or allow deleting items', async () => {
    for (const method of ['batch', 'crm.item.delete', '../user.get', 'https://evil.example', 'im.notify.personal.add']) {
      await expect(proxy.call(staff, method, {})).rejects.toBeInstanceOf(ForbiddenException)
    }
    await expect(proxy.call(staff, 'crm.item.list', { entityTypeId: 9999 })).rejects.toBeInstanceOf(ForbiddenException)
    for (const key of ['auth', 'access_token', 'callback']) await expect(proxy.call(staff, 'user.get', { [key]: 'fake' })).rejects.toBeInstanceOf(BadRequestException)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not leak privileged URL or upstream errors during a transport failure', async () => {
    fetchMock.mockRejectedValue(new Error('network error at /rest/3/server-credential/'))
    await expect(proxy.call(staff, 'user.get', {})).rejects.toThrow('Битрикс24 временно недоступен')
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ error: 'INVALID_TOKEN', error_description: 'secret=server-credential' }) })
    await expect(proxy.call(staff, 'user.get', {})).rejects.toThrow('Не удалось получить данные из Битрикс24')
  })
  it('refuses cross-origin configured integrations and redirects', async () => {
    const other = new EmployeeRestService(mockAuth as unknown as EmployeeAuthService, new ConfigService({ API_URL: 'https://evil.example/rest/' }))
    await expect(other.call(staff, 'user.get', {})).rejects.toBeInstanceOf(BadGatewayException)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValue({ ok: false, status: 302, json: async () => ({ result: [] }) })
    await expect(proxy.call(staff, 'user.get', {})).rejects.toBeInstanceOf(BadGatewayException)
  })
})
