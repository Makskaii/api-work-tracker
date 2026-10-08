/** biome-ignore-all lint/suspicious/useAwait: test doubles intentionally model asynchronous Redis and HTTP interfaces. */
import { BadGatewayException, BadRequestException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createDecipheriv, createHash } from 'node:crypto'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { RedisService } from '../shared/redis/redis.service'
import { EMPLOYEE_SESSION_COOKIE, EMPLOYEE_STATE_COOKIE, EmployeeAuthService } from './employee-auth.service'
import type { ResolvedEmployeeSession, StoredEmployeeSession } from './employee-auth.types'

const portal = 'https://crm.example.test'
const key = 'a'.repeat(64)
const settings: Record<string, string> = {
  API_URL: `${portal}/rest/1/server-only-credential/`, BITRIX_OAUTH_CLIENT_ID: 'local.test-client',
  BITRIX_OAUTH_CLIENT_SECRET: 'synthetic-secret', BITRIX_OAUTH_MEMBER_ID: 'member-test',
  BITRIX_OAUTH_SESSION_KEY: key, BITRIX_OAUTH_ORIGIN: 'https://oauth.bitrix24.tech',
}
const departmentRows = [{ ID: 23, PARENT: 1 }, { ID: 25, PARENT: 1 }, { ID: 19, PARENT: 1 }]
const currentUser = { ID: '77', ACTIVE: 'Y', NAME: 'Имя', LAST_NAME: 'Фамилия', UF_DEPARTMENT: [23] }
const tokens = (overrides: Record<string, unknown> = {}) => ({
  access_token: 'synthetic-access-1', refresh_token: 'synthetic-refresh-1', expires_in: 3600,
  client_endpoint: `${portal}/rest/`, server_endpoint: 'https://oauth.bitrix24.tech/rest/', member_id: 'member-test', user_id: 77,
  ...overrides,
})
const response = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response
const sidCookie = (session: ResolvedEmployeeSession) => `${EMPLOYEE_SESSION_COOKIE}=${session.sessionId}`

describe('employee Bitrix OAuth sessions', () => {
  let service: EmployeeAuthService
  let now: number
  let values: Map<string, string>
  let redis: {
    get: jest.Mock; set: jest.Mock; setJson: jest.Mock; getDel: jest.Mock; del: jest.Mock;
    acquireLock: jest.Mock; releaseLock: jest.Mock; compareAndSet: jest.Mock;
  }
  let bitrix: { listDepartments: jest.Mock }
  let fetchMock: jest.SpyInstance
  let user: Record<string, unknown>
  let tokenData: Record<string, unknown>

  beforeEach(() => {
    now = Date.parse('2026-10-08T12:00:00Z')
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    values = new Map()
    redis = {
      get: jest.fn(async (name: string) => values.get(name) ?? null),
      set: jest.fn(async (name: string, value: string) => { values.set(name, value) }),
      setJson: jest.fn(async (name: string, value: unknown) => { values.set(name, JSON.stringify(value)) }),
      getDel: jest.fn(async (name: string) => { const value = values.get(name) ?? null; values.delete(name); return value }),
      del: jest.fn(async (name: string) => { values.delete(name) }),
      acquireLock: jest.fn(async (name: string, owner: string) => { if (values.has(name)) return false; values.set(name, owner); return true }),
      releaseLock: jest.fn(async (name: string, owner: string) => { if (values.get(name) === owner) values.delete(name) }),
      compareAndSet: jest.fn(async (name: string, expected: string, value: string) => {
        if (values.get(name) !== expected) return false
        values.set(name, value)
        return true
      }),
    }
    bitrix = { listDepartments: jest.fn(async () => departmentRows) }
    service = new EmployeeAuthService({ get: (name: string) => settings[name] } as ConfigService, redis as unknown as RedisService, bitrix as unknown as BitrixService)
    user = { ...currentUser }
    tokenData = tokens()
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/oauth/token/')) return response(tokenData)
      if (String(url).includes('/user.current.json')) return response({ result: user })
      if (String(url).includes('/user.admin.json')) return response({ result: false })
      return response({ result: { id: 123 } })
    })
  })

  afterEach(() => jest.restoreAllMocks())

  const login = async () => {
    const start = await service.beginLogin('/development-kanban')
    return service.completeLogin({ code: 'synthetic-code', state: start.state, domain: 'crm.example.test' }, `${EMPLOYEE_STATE_COOKIE}=${start.state}`, portal)
  }

  const storedRecord = (session: ResolvedEmployeeSession): StoredEmployeeSession => {
    const idHash = createHash('sha256').update(session.sessionId).digest('hex')
    const raw = values.get(`wt:employee:session:${idHash}`)
    expect(raw).toBeDefined()
    const packed = Buffer.from(raw as string, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), packed.subarray(0, 12))
    decipher.setAAD(Buffer.from('work-tracker:employee-session:v1'))
    decipher.setAuthTag(packed.subarray(12, 28))
    return JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')) as StoredEmployeeSession
  }

  it('pins authorization URL and keeps client secret, tokens and identity out of the redirect', async () => {
    const begin = await service.beginLogin('/reports/calendar')
    const url = new URL(begin.url)
    expect(url.origin).toBe(portal)
    expect(url.pathname).toBe('/oauth/authorize/')
    expect(url.searchParams.get('client_id')).toBe(settings.BITRIX_OAUTH_CLIENT_ID)
    expect(url.searchParams.get('state')).toBe(begin.state)
    expect(begin.url).not.toContain(settings.BITRIX_OAUTH_CLIENT_SECRET)
    expect(Array.from(values.keys())[0]).not.toContain(begin.state)
  })

  it.each(['//external.test', '/\\external.test', '/a/../b', '/has space'])('rejects unsafe return destinations %s', async (returnTo) => {
    await expect(service.beginLogin(returnTo)).rejects.toThrow(BadRequestException)
    expect(redis.setJson).not.toHaveBeenCalled()
  })

  it.each(['BITRIX_OAUTH_SESSION_KEY', 'BITRIX_OAUTH_CLIENT_SECRET', 'BITRIX_OAUTH_MEMBER_ID'])('has no permissive defaults when %s is missing', async (missing) => {
    const broken = new EmployeeAuthService({ get: (name: string) => name === missing ? undefined : settings[name] } as ConfigService, redis as unknown as RedisService, bitrix as unknown as BitrixService)
    await expect(broken.beginLogin()).rejects.toThrow(ServiceUnavailableException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a caller-configurable token endpoint instead of sending credentials to it', async () => {
    const broken = new EmployeeAuthService({ get: (name: string) => name === 'BITRIX_OAUTH_ORIGIN' ? 'https://attacker.test' : settings[name] } as ConfigService, redis as unknown as RedisService, bitrix as unknown as BitrixService)
    await expect(broken.beginLogin()).rejects.toThrow(ServiceUnavailableException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('binds the callback to its state cookie and same origin', async () => {
    const begin = await service.beginLogin()
    await expect(service.completeLogin({ code: 'x', state: begin.state }, undefined, portal)).rejects.toThrow(UnauthorizedException)
    await expect(service.completeLogin({ code: 'x', state: begin.state }, `${EMPLOYEE_STATE_COOKIE}=${begin.state}`, 'https://external.test')).rejects.toThrow(ForbiddenException)
    expect(redis.getDel).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('consumes state atomically and refuses replay before another token exchange', async () => {
    const begin = await service.beginLogin()
    const dto = { code: 'synthetic-code', state: begin.state }
    const cookie = `${EMPLOYEE_STATE_COOKIE}=${begin.state}`
    await service.completeLogin(dto, cookie, portal)
    await expect(service.completeLogin(dto, cookie, portal)).rejects.toThrow(UnauthorizedException)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth/token/'))).toHaveLength(1)
    expect(redis.getDel).toHaveBeenCalledTimes(2)
  })

  it('does not accept callback state after the short login window', async () => {
    const begin = await service.beginLogin()
    now += 5 * 60 * 1000 + 1
    await expect(service.completeLogin({ code: 'x', state: begin.state }, `${EMPLOYEE_STATE_COOKIE}=${begin.state}`, portal)).rejects.toThrow(UnauthorizedException)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { member_id: 'foreign-member' }, { client_endpoint: 'https://foreign.test/rest/' },
    { client_endpoint: `${portal}/rest/1/webhook/` }, { server_endpoint: 'https://foreign.test/rest/' },
    { user_id: 999 }, { expires_in: 0 },
  ])('rejects token responses for another portal/user or invalid expiry: %j', async (override) => {
    tokenData = tokens(override)
    await expect(login()).rejects.toThrow(UnauthorizedException)
    expect(Array.from(values.keys()).filter((name) => name.startsWith('wt:employee:session:'))).toHaveLength(0)
  })

  it('encrypts OAuth credentials in Redis, hashes the opaque session ID and returns a safe public DTO', async () => {
    const { session, returnTo } = await login()
    expect(returnTo).toBe('/development-kanban')
    const persisted = Array.from(values.entries()).find(([name]) => name.startsWith('wt:employee:session:'))
    expect(persisted?.[0]).not.toContain(session.sessionId)
    expect(persisted?.[1]).not.toContain('synthetic-access')
    expect(persisted?.[1]).not.toContain('synthetic-refresh')
    expect(storedRecord(session).refreshToken).toBe('synthetic-refresh-1')
    const dto = service.response(session)
    expect(dto).toMatchObject({ user: { id: 77 }, rules: [{ action: 'read', subject: 'post' }], portalOrigin: portal })
    expect(JSON.stringify(dto)).not.toMatch(/accessToken|refreshToken|sessionId|synthetic-access/)
    expect(dto.csrfToken).toHaveLength(43)
    expect(await service.resolveSession(sidCookie(session))).toMatchObject({ accessToken: 'synthetic-access-1' })
  })

  it('requires the exact origin and CSRF header before a cookie mutation', async () => {
    const { session } = await login()
    expect(() => service.assertCsrf(portal, session.csrfToken, session)).not.toThrow()
    expect(() => service.assertCsrf(portal, undefined, session)).toThrow(ForbiddenException)
    expect(() => service.assertCsrf(portal, [session.csrfToken], session)).toThrow(ForbiddenException)
    expect(() => service.assertCsrf('https://external.test', session.csrfToken, session)).toThrow(ForbiddenException)
  })

  it('refreshes once under concurrent requests and saves rotated refresh credentials', async () => {
    const { session } = await login()
    now += 59 * 60 * 1000
    tokenData = tokens({ access_token: 'synthetic-access-2', refresh_token: 'synthetic-refresh-2' })
    const [first, second] = await Promise.all([service.resolveSession(sidCookie(session)), service.resolveSession(sidCookie(session))])
    expect(first.accessToken).toBe('synthetic-access-2')
    expect(second.accessToken).toBe('synthetic-access-2')
    expect(storedRecord(session).refreshToken).toBe('synthetic-refresh-2')
    const exchanges = fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth/token/'))
    expect(exchanges).toHaveLength(2) // Initial code exchange plus one refresh.
    const refreshBody = new URLSearchParams(String(exchanges[1][1]?.body))
    expect(refreshBody.get('grant_type')).toBe('refresh_token')
    expect(refreshBody.get('refresh_token')).toBe('synthetic-refresh-1')
    expect(redis.releaseLock).toHaveBeenCalledTimes(1)
  })

  it('preserves rotated credentials even if the identity refresh temporarily fails', async () => {
    const { session } = await login()
    now += 59 * 60 * 1000
    tokenData = tokens({ access_token: 'synthetic-access-2', refresh_token: 'synthetic-refresh-2' })
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/oauth/token/')) return response(tokenData)
      throw new Error('Do not expose raw token transport details')
    })
    await expect(service.resolveSession(sidCookie(session))).rejects.toThrow(BadGatewayException)
    expect(storedRecord(session).refreshToken).toBe('synthetic-refresh-2')
    expect(storedRecord(session).identityCheckedAt).toBe(0)
  })

  it('revokes an inactive employee and its stored cookie session after at most five minutes', async () => {
    const { session } = await login()
    now += 5 * 60 * 1000
    user = { ...currentUser, ACTIVE: 'N' }
    await expect(service.resolveSession(sidCookie(session))).rejects.toThrow(ForbiddenException)
    await expect(service.resolveSession(sidCookie(session))).rejects.toThrow(UnauthorizedException)
  })

  it('does not extend cached department roles for another five minutes', async () => {
    await login()
    now += 4 * 60 * 1000
    const { session } = await login()
    now += 61 * 1000
    bitrix.listDepartments.mockResolvedValue([{ ID: 23, PARENT: 1 }, { ID: 25, PARENT: 1 }, { ID: 19, PARENT: 1 }])
    await service.resolveSession(sidCookie(session))
    expect(bitrix.listDepartments).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/user.current'))).toHaveLength(3)
  })

  it('does not resurrect a session logged out during an upstream refresh', async () => {
    const { session } = await login()
    now += 5 * 60 * 1000
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/user.current.json')) { await service.logout(session); return response({ result: user }) }
      return response({ result: false })
    })
    await expect(service.resolveSession(sidCookie(session))).rejects.toThrow(UnauthorizedException)
    expect(Array.from(values.keys()).filter((name) => name.startsWith('wt:employee:session:'))).toHaveLength(0)
  })

  it('allows CSRF-verified logout without reauthenticating revoked department permissions', async () => {
    const { session } = await login()
    now += 5 * 60 * 1000
    user = { ...currentUser, UF_DEPARTMENT: [40] }
    const requestsBefore = fetchMock.mock.calls.length
    await service.logoutFromCookie(sidCookie(session), portal, session.csrfToken)
    expect(fetchMock.mock.calls.length).toBe(requestsBefore)
    await expect(service.resolveSession(sidCookie(session))).rejects.toThrow(UnauthorizedException)
  })

  it('allows CSRF-verified logout after OAuth expiry without refreshing the revoked token', async () => {
    const { session } = await login()
    now += 61 * 60 * 1000
    fetchMock.mockImplementation(async () => response({ error: 'invalid_grant' }, 401))
    const requestsBefore = fetchMock.mock.calls.length
    await service.logoutFromCookie(sidCookie(session), portal, session.csrfToken)
    expect(fetchMock.mock.calls.length).toBe(requestsBefore)
    await expect(service.resolveSession(sidCookie(session))).rejects.toThrow(UnauthorizedException)
  })

  it('rejects wrong/missing CSRF and foreign-origin logout without deleting a valid session', async () => {
    const { session } = await login()
    await expect(service.logoutFromCookie(sidCookie(session), portal, undefined)).rejects.toThrow(ForbiddenException)
    await expect(service.logoutFromCookie(sidCookie(session), portal, 'x'.repeat(43))).rejects.toThrow(ForbiddenException)
    await expect(service.logoutFromCookie(sidCookie(session), 'https://foreign.test', session.csrfToken)).rejects.toThrow(ForbiddenException)
    expect(await service.resolveSession(sidCookie(session))).toMatchObject({ sessionId: session.sessionId })
  })

  it('permits clearing a stale browser cookie after server revocation but still rejects cross-site logout', async () => {
    const { session } = await login()
    await service.logout(session)
    await expect(service.logoutFromCookie(sidCookie(session), 'https://foreign.test', session.csrfToken)).rejects.toThrow(ForbiddenException)
    await expect(service.logoutFromCookie(sidCookie(session), portal, undefined)).rejects.toThrow(ForbiddenException)
    await expect(service.logoutFromCookie(sidCookie(session), portal, session.csrfToken)).resolves.toBeUndefined()
  })

  it('keeps the standalone SID/CSRF and refresh credentials when the same employee opens an iframe', async () => {
    const { session: previous } = await login()
    const frame = await service.createFrameSession('synthetic-frame-token', sidCookie(previous), portal)
    expect(frame.sessionId).toBe(previous.sessionId)
    expect(frame.csrfToken).toBe(previous.csrfToken)
    expect(frame.expiresAt - now).toBe(7 * 24 * 60 * 60 * 1000)
    expect(storedRecord(frame).refreshToken).toBe('synthetic-refresh-1')
    expect(await service.resolveSession(sidCookie(previous))).toMatchObject({ sessionId: previous.sessionId })
  })

  it('keeps a same-employee iframe session stable across tabs', async () => {
    const first = await service.createFrameSession('synthetic-frame-token', undefined, portal)
    const second = await service.createFrameSession('fresh-synthetic-frame-token', sidCookie(first), portal)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.csrfToken).toBe(first.csrfToken)
    expect(second.expiresAt).toBe(first.expiresAt)
    expect(storedRecord(second).refreshToken).toBe('')
  })

  it('creates a bounded iframe session with no refresh credentials and invalidates a different employee session', async () => {
    const { session: previous } = await login()
    user = { ...currentUser, ID: '88' }
    const frame = await service.createFrameSession('synthetic-frame-token', sidCookie(previous), portal)
    expect(frame.expiresAt - now).toBe(50 * 60 * 1000)
    expect(storedRecord(frame).refreshToken).toBe('')
    await expect(service.resolveSession(sidCookie(previous))).rejects.toThrow(UnauthorizedException)
    now += 50 * 60 * 1000
    await expect(service.resolveSession(sidCookie(frame))).rejects.toThrow(UnauthorizedException)
  })

  it('rejects malformed or duplicate session cookies instead of guessing a user', async () => {
    await expect(service.resolveSession(`${EMPLOYEE_SESSION_COOKIE}=invalid`)).rejects.toThrow(UnauthorizedException)
    const { session } = await login()
    await expect(service.resolveSession(`${sidCookie(session)}; ${sidCookie(session)}`)).rejects.toThrow(UnauthorizedException)
  })

  it('pins OAuth REST calls to the portal and sends no token in the URL', async () => {
    const { session } = await login()
    await service.callRest(session, 'crm.item.update', { entityTypeId: 1060, id: 12, fields: { title: 'Example' } })
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect(url).toBe(`${portal}/rest/crm.item.update.json`)
    expect(String(url)).not.toContain(session.accessToken)
    expect(JSON.parse(String(init?.body)).auth).toBe(session.accessToken)
    expect(init).toMatchObject({ redirect: 'manual', credentials: 'omit' })
    await expect(service.callRest(session, 'https://foreign.test', {})).rejects.toThrow(BadRequestException)
    await expect(service.callRest(session, 'crm.item.update', { auth: 'other-token' })).rejects.toThrow(BadRequestException)
  })

  it('does not retry ambiguous mutations or expose secret-bearing upstream failures', async () => {
    const { session } = await login()
    fetchMock.mockRejectedValueOnce(new Error('transport token=synthetic-access-1'))
    const calls = fetchMock.mock.calls.length
    await expect(service.callRest(session, 'crm.item.update', { id: 12 })).rejects.toThrow('Битрикс24 не ответил')
    expect(fetchMock.mock.calls.length - calls).toBe(1)
  })

  it('shares one identity check across 25 startup calls and the frame handshake', async () => {
    let releaseUser!: (value: Response) => void
    const pendingUser = new Promise<Response>((resolve) => { releaseUser = resolve })
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/user.current.json')) return await pendingUser
      return response({ result: false })
    })
    const startup = Array.from({ length: 25 }, () => service.resolveIframe('shared-startup-token'))
    const frame = service.createFrameSession('shared-startup-token', undefined, portal)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/user.current'))).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/user.admin'))).toHaveLength(1)
    expect(bitrix.listDepartments).toHaveBeenCalledTimes(1)
    releaseUser(response({ result: currentUser }))
    const sessions = await Promise.all(startup)
    expect(sessions.every((session) => session.identity.user.id === 77)).toBe(true)
    expect((await frame).identity.user.id).toBe(77)
    expect(fetchMock.mock.calls).toHaveLength(2)
  })

  it('shares the department hierarchy request across different users validating concurrently', async () => {
    let releaseDepartments!: (value: Array<Record<string, unknown>>) => void
    const pendingDepartments = new Promise<Array<Record<string, unknown>>>((resolve) => { releaseDepartments = resolve })
    bitrix.listDepartments.mockReturnValue(pendingDepartments)
    fetchMock.mockImplementation(async (url, init) => {
      const token = JSON.parse(String(init?.body)).auth as string
      const index = Number(token.split('-').at(-1))
      return response({ result: String(url).includes('/user.current.json') ? { ...currentUser, ID: String(77 + index) } : false })
    })
    const sessions = Array.from({ length: 5 }, (_, index) => service.resolveIframe(`employee-token-${index}`))
    expect(bitrix.listDepartments).toHaveBeenCalledTimes(1)
    releaseDepartments(departmentRows)
    expect((await Promise.all(sessions)).map((session) => session.identity.user.id)).toEqual([77, 78, 79, 80, 81])
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/user.current'))).toHaveLength(5)
  })

  it('releases a failed shared identity check and permits a fresh retry', async () => {
    let failUser!: (error: Error) => void
    const pendingUser = new Promise<Response>((_, reject) => { failUser = reject })
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/user.current.json')) return await pendingUser
      return response({ result: false })
    })
    const attempts = Array.from({ length: 25 }, () => service.resolveIframe('same-failing-token'))
    failUser(new Error('upstream unavailable'))
    const results = await Promise.allSettled(attempts)
    expect(results.every((result) => result.status === 'rejected' && result.reason instanceof BadGatewayException)).toBe(true)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/user.current'))).toHaveLength(1)
    fetchMock.mockImplementation(async (url) => response({ result: String(url).includes('/user.current.json') ? currentUser : false }))
    expect((await service.resolveIframe('same-failing-token')).identity.user.id).toBe(77)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/user.current'))).toHaveLength(2)
  })

  it('releases a failed department request so the next permission lookup can retry', async () => {
    bitrix.listDepartments.mockRejectedValueOnce(new BadGatewayException('Unavailable departments'))
    const first = await Promise.allSettled([
      service.resolveIframe('first-token'), service.resolveIframe('second-token'),
    ])
    expect(first.every((result) => result.status === 'rejected')).toBe(true)
    expect(bitrix.listDepartments).toHaveBeenCalledTimes(1)
    expect((await service.resolveIframe('first-token')).identity.user.id).toBe(77)
    expect(bitrix.listDepartments).toHaveBeenCalledTimes(2)
  })
})
