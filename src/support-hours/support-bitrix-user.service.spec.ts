import {
  BadGatewayException, BadRequestException, ForbiddenException, GatewayTimeoutException,
  HttpException, InternalServerErrorException, NotFoundException, UnauthorizedException,
} from '@nestjs/common'
import { DailyReportCodes, EntityTypeIds } from '../constants/const'
import { SupportBitrixUserService } from './support-bitrix-user.service'

const token = 'test-user-oauth-secret'
const portal = 'https://crm.example.test'
const configuredWebhook = `${portal}/rest/12/privileged-server-secret/`
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const currentUser = () => json({ result: { ID: '12', ACTIVE: true, NAME: 'Analyst' } })
const item = (id: number, fields: Record<string, unknown> = {}) => json({ result: { item: { id, ...fields } } })
const service = (url = configuredWebhook) => new SupportBitrixUserService({ get: jest.fn().mockReturnValue(url) } as never)

describe('SupportBitrixUserService', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>
  beforeEach(() => { fetchMock = jest.spyOn(globalThis, 'fetch') })
  afterEach(() => { fetchMock.mockRestore() })

  it('verifies the current user through OAuth on the configured portal, without the webhook path or URL token', async () => {
    fetchMock.mockResolvedValueOnce(currentUser())
    const instance = service()
    expect(await instance.verifyUser(token)).toEqual({ id: 12 })
    expect(fetchMock).toHaveBeenCalledWith(`${portal}/rest/user.current.json`, expect.objectContaining({
      method: 'POST', redirect: 'manual', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ auth: token }), signal: expect.any(AbortSignal),
    }))
    expect(JSON.stringify(instance)).not.toContain(token)
    expect(JSON.stringify(instance)).not.toContain('privileged-server-secret')
  })

  it.each([undefined, '', 'token with spaces', 'secret\r\nHost: evil.example', 'x'.repeat(4097)])('rejects an absent or malformed access token without making a request', async (invalid) => {
    await expect(service().verifyUser(invalid)).rejects.toBeInstanceOf(UnauthorizedException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['', 'not-a-url', 'http://crm.example.test/rest/', 'https://user:password@crm.example.test/rest/', 'file:///tmp/rest'])('rejects unsafe or invalid portal configuration without exposing the configured value', (url) => {
    try {
      service(url)
      throw new Error('Expected invalid configuration to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(InternalServerErrorException)
      if (url) expect(String(error)).not.toContain(url)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads an allowed task with the same token only after verifying its user', async () => {
    fetchMock.mockResolvedValueOnce(currentUser()).mockResolvedValueOnce(item(1002, { title: 'Task' }))
    expect(await service().getItem(token, EntityTypeIds.tasks, 1002)).toEqual({ id: 1002, title: 'Task' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${portal}/rest/user.current.json`, `${portal}/rest/crm.item.get.json`])
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ entityTypeId: 1072, id: 1002, useOriginalUfNames: 'N', auth: token })
  })

  it.each([[2, 10], [EntityTypeIds.projects, 94], [EntityTypeIds.tasks, 0], [EntityTypeIds.reports, 1.5]])('rejects out-of-scope item types or invalid IDs (%s, %s)', async (entityTypeId, id) => {
    await expect(service().getItem(token, entityTypeId, id)).rejects.toBeInstanceOf(BadRequestException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not read or mutate CRM data when user verification fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'expired_token', error_description: `Secret: ${token}` }, 401))
    await expect(service().setReportAccounting(token, 5402, true)).rejects.toBeInstanceOf(UnauthorizedException)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['Y', true, 1, '1'])('sets only the accounting flag and confirms persisted enabled value %s using user permissions', async (flag) => {
    fetchMock.mockResolvedValueOnce(currentUser()).mockResolvedValueOnce(item(5402)).mockResolvedValueOnce(item(5402, { [DailyReportCodes.includeInPackage]: flag }))
    expect(await service().setReportAccounting(token, 5402, true)).toEqual({ id: 5402, includeInPackage: true })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([`${portal}/rest/user.current.json`, `${portal}/rest/crm.item.update.json`, `${portal}/rest/crm.item.get.json`])
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      entityTypeId: 1060, id: 5402, useOriginalUfNames: 'N', fields: { [DailyReportCodes.includeInPackage]: 'Y' }, auth: token,
    })
    for (const [, options] of fetchMock.mock.calls) expect(JSON.parse(String(options?.body)).auth).toBe(token)
  })

  it.each(['N', false, 0, '0'])('confirms persisted disabled value %s without treating a nonempty N string as enabled', async (flag) => {
    fetchMock.mockResolvedValueOnce(currentUser()).mockResolvedValueOnce(item(5402)).mockResolvedValueOnce(item(5402, { [DailyReportCodes.includeInPackage]: flag }))
    expect(await service().setReportAccounting(token, 5402, false)).toEqual({ id: 5402, includeInPackage: false })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).fields).toEqual({ [DailyReportCodes.includeInPackage]: 'N' })
  })

  it.each(['N', undefined, 'unexpected'])('fails closed when the saved report does not confirm the requested flag: %s', async (flag) => {
    fetchMock.mockResolvedValueOnce(currentUser()).mockResolvedValueOnce(item(5402)).mockResolvedValueOnce(item(5402, { [DailyReportCodes.includeInPackage]: flag }))
    await expect(service().setReportAccounting(token, 5402, true)).rejects.toBeInstanceOf(BadGatewayException)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry a mutation or claim success when reading its result fails', async () => {
    fetchMock.mockResolvedValueOnce(currentUser()).mockResolvedValueOnce(item(5402)).mockRejectedValueOnce(new Error(`Network failed with ${token}`))
    await expect(service().setReportAccounting(token, 5402, true)).rejects.toThrow('Проверьте результат операции')
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('crm.item.update'))).toHaveLength(1)
  })

  it('rejects a mismatched item ID in the update response before claiming success', async () => {
    fetchMock.mockResolvedValueOnce(currentUser()).mockResolvedValueOnce(item(999))
    await expect(service().setReportAccounting(token, 5402, true)).rejects.toBeInstanceOf(BadGatewayException)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects nonboolean accounting values before contacting Bitrix', async () => {
    await expect(service().setReportAccounting(token, 5402, 'false' as never)).rejects.toBeInstanceOf(BadRequestException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['ACCESS_DENIED', 400, ForbiddenException],
    ['insufficient_scope', 401, ForbiddenException],
    ['allowed_only_intranet_user', 403, ForbiddenException],
    ['expired_token', 401, UnauthorizedException],
    ['NOT_FOUND', 400, NotFoundException],
    ['unrecognized', 500, BadGatewayException],
  ])('maps upstream %s without leaking error details or the token', async (code, status, exception) => {
    fetchMock.mockResolvedValueOnce(json({ error: code, error_description: `${token} ${configuredWebhook}` }, Number(status)))
    const error = await service().verifyUser(token).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(exception as typeof HttpException)
    expect(JSON.stringify(error)).not.toContain(token)
    expect(JSON.stringify(error)).not.toContain(configuredWebhook)
  })

  it('handles REST errors even when returned with HTTP 200', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'ACCESS_DENIED', error_description: token }))
    await expect(service().verifyUser(token)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('returns a retryable status for portal throttling', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'QUERY_LIMIT_EXCEEDED' }, 503))
    await expect(service().verifyUser(token)).rejects.toMatchObject({ status: 429 })
  })

  it('refuses redirects instead of forwarding the user token to a different origin', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 307, headers: { Location: 'https://evil.example/receive' } }))
    await expect(service().verifyUser(token)).rejects.toBeInstanceOf(BadGatewayException)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual')
  })

  it('sanitizes network errors and timeout errors, including nested request secrets', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`fetch failed: ${token}`, { cause: { body: token } }))
    const failed = await service().verifyUser(token).catch((cause: unknown) => cause)
    expect(failed).toBeInstanceOf(BadGatewayException)
    expect(JSON.stringify(failed)).not.toContain(token)
    fetchMock.mockRejectedValueOnce(new DOMException(token, 'TimeoutError'))
    const timeout = await service().verifyUser(token).catch((cause: unknown) => cause)
    expect(timeout).toBeInstanceOf(GatewayTimeoutException)
    expect(JSON.stringify(timeout)).not.toContain(token)
  })

  it.each([null, [], { result: [] }, { result: { ID: 'not-an-id' } }])('rejects malformed user responses', async (body) => {
    fetchMock.mockResolvedValueOnce(json(body))
    await expect(service().verifyUser(token)).rejects.toBeInstanceOf(BadGatewayException)
  })

  it('rejects an explicitly inactive current user', async () => {
    fetchMock.mockResolvedValueOnce(json({ result: { ID: '12', ACTIVE: false } }))
    await expect(service().verifyUser(token)).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('does not leak a non-JSON upstream error page', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`<html>${token}</html>`, { status: 502 }))
    const error = await service().verifyUser(token).catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(BadGatewayException)
    expect(JSON.stringify(error)).not.toContain(token)
  })
})
