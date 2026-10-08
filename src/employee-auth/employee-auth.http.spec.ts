/** biome-ignore-all lint/suspicious/useAwait: test doubles model asynchronous storage and upstream transport. */
import { Body, Controller, Get, Post, ValidationPipe } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { RedisService } from '../shared/redis/redis.service'
import { EmployeeAccessGuard } from './employee-access.guard'
import { EmployeeAuthController } from './employee-auth.controller'
import { EmployeeAuthService } from './employee-auth.service'
import { EmployeeRestController } from './employee-rest.controller'
import { EmployeeRestService } from './employee-rest.service'

@Controller('project-reports')
class ProtectedProjectStub {
  @Get('projects')
  find() { return [{ id: 1, title: 'Example project' }] }

  @Post('projects')
  create(@Body() body: Record<string, unknown>) { return { saved: true, body } }
}

const portal = 'https://crm.example.test'
const config: Record<string, string> = {
  API_URL: `${portal}/rest/1/server-credential/`, BITRIX_OAUTH_CLIENT_ID: 'local.synthetic',
  BITRIX_OAUTH_CLIENT_SECRET: 'synthetic-secret', BITRIX_OAUTH_MEMBER_ID: 'member-test',
  BITRIX_OAUTH_SESSION_KEY: 'b'.repeat(64), BITRIX_OAUTH_ORIGIN: 'https://oauth.bitrix24.tech',
  EMPLOYEE_AUTH_ENFORCE: 'true',
}
const upstream = (data: unknown): Response => ({ ok: true, status: 200, json: async () => data }) as Response
const cookies = (response: { headers: Record<string, unknown> }): string[] => {
  const value = response.headers['set-cookie']
  return Array.isArray(value) ? value as string[] : typeof value === 'string' ? [value] : []
}
const cookie = (response: { headers: Record<string, unknown> }, name: string) => {
  const found = cookies(response).find((value) => value.startsWith(`${name}=`))
  if (!found) throw new Error(`Missing ${name} response cookie`)
  return found.split(';')[0]
}

describe('employee authentication HTTP boundary', () => {
  let app: INestApplication
  let stateValues: Map<string, string>
  let fetchMock: jest.SpyInstance
  let currentUserId: number
  let now: number
  let departmentIds: number[]

  beforeEach(async () => {
    currentUserId = 77
    departmentIds = [23]
    now = Date.parse('2026-10-08T12:00:00Z')
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    stateValues = new Map()
    const redis = {
      get: jest.fn(async (name: string) => stateValues.get(name) ?? null),
      set: jest.fn(async (name: string, value: string) => { stateValues.set(name, value) }),
      setJson: jest.fn(async (name: string, value: unknown) => { stateValues.set(name, JSON.stringify(value)) }),
      getDel: jest.fn(async (name: string) => { const value = stateValues.get(name) ?? null; stateValues.delete(name); return value }),
      del: jest.fn(async (name: string) => { stateValues.delete(name) }),
      acquireLock: jest.fn(async (name: string, owner: string) => { if (stateValues.has(name)) return false; stateValues.set(name, owner); return true }),
      releaseLock: jest.fn(async (name: string, owner: string) => { if (stateValues.get(name) === owner) stateValues.delete(name) }),
      compareAndSet: jest.fn(async (name: string, expected: string, value: string) => {
        if (stateValues.get(name) !== expected) return false
        stateValues.set(name, value)
        return true
      }),
    }
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/oauth/token/')) return upstream({
        access_token: 'synthetic-access-http', refresh_token: 'synthetic-refresh-http', expires_in: 3600,
        member_id: 'member-test', user_id: currentUserId, client_endpoint: `${portal}/rest/`, server_endpoint: 'https://oauth.bitrix24.tech/rest/',
      })
      if (String(url).includes('/user.current.json')) return upstream({
        result: { ID: String(currentUserId), ACTIVE: 'Y', NAME: 'Example', LAST_NAME: 'Employee', UF_DEPARTMENT: departmentIds },
      })
      if (String(url).includes('/user.admin.json')) return upstream({ result: false })
      return upstream({ result: { items: [{ id: 123 }] }, total: 1 })
    })
    const module = await Test.createTestingModule({
      controllers: [EmployeeAuthController, EmployeeRestController, ProtectedProjectStub],
      providers: [
        EmployeeAuthService, EmployeeRestService,
        { provide: APP_GUARD, useClass: EmployeeAccessGuard },
        { provide: ConfigService, useValue: { get: (name: string) => config[name] } },
        { provide: RedisService, useValue: redis },
        { provide: BitrixService, useValue: { listDepartments: jest.fn(async () => [{ ID: 23, PARENT: 1 }]) } },
      ],
    }).compile()
    app = module.createNestApplication({ logger: false })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }))
    await app.listen(0, '127.0.0.1')
  })

  afterEach(async () => {
    await app.close()
    jest.restoreAllMocks()
  })

  const startAndComplete = async () => {
    const begin = await request(app.getHttpServer()).get('/auth/employee/login').query({ returnTo: '/development-kanban' }).expect(302)
    const stateCookie = cookie(begin, 'wt_employee_oauth_state')
    const state = new URL(begin.headers.location).searchParams.get('state')
    const complete = await request(app.getHttpServer()).post('/auth/employee/complete')
      .set('Origin', portal).set('Cookie', stateCookie)
      .send({ code: 'synthetic-code-http', state, domain: 'crm.example.test' }).expect(200)
    return { begin, complete, state, stateCookie, sid: cookie(complete, 'wt_employee_session'), csrf: complete.body.csrfToken as string }
  }

  it('uses secure scoped cookies and returns identity/permissions without credentials', async () => {
    const result = await startAndComplete()
    expect(cookies(result.begin)[0]).toMatch(/Path=\/devapps\/work-tracker\//)
    expect(cookies(result.begin)[0]).toContain('HttpOnly')
    expect(cookies(result.begin)[0]).toContain('Secure')
    expect(cookies(result.begin)[0]).toContain('SameSite=Lax')
    const sessionCookie = cookies(result.complete).find((value) => value.startsWith('wt_employee_session='))
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Secure')
    expect(sessionCookie).toContain('SameSite=Lax')
    expect(sessionCookie).toContain('Path=/devapps/work-tracker/')
    expect(result.complete.body).toMatchObject({ returnTo: '/development-kanban', user: { id: 77 }, rules: [{ action: 'read', subject: 'post' }] })
    expect(JSON.stringify(result.complete.body)).not.toMatch(/accessToken|refreshToken|sessionId|synthetic-access|synthetic-refresh/)
    const me = await request(app.getHttpServer()).get('/auth/employee/me').set('Cookie', result.sid).expect(200)
    expect(me.body.csrfToken).toBe(result.csrf)
    expect(JSON.stringify(me.body)).not.toMatch(/accessToken|refreshToken|sessionId|synthetic-access|synthetic-refresh/)
  })

  it('requires browser-bound one-time state and rejects both replay and injected identity fields', async () => {
    const result = await startAndComplete()
    await request(app.getHttpServer()).post('/auth/employee/complete').set('Origin', portal)
      .set('Cookie', result.stateCookie).send({ code: 'synthetic-code-http', state: result.state }).expect(401)
    await request(app.getHttpServer()).post('/auth/employee/complete').set('Origin', portal)
      .send({ code: 'synthetic-code-http', state: result.state }).expect(401)
    await request(app.getHttpServer()).post('/auth/employee/complete').set('Origin', portal)
      .send({ code: 'synthetic-code-http', state: result.state, userId: 1, isAdmin: true }).expect(400)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth/token/'))).toHaveLength(1)
  })

  it('guards anonymous data and cookie writes while allowing authorized same-origin operations', async () => {
    await request(app.getHttpServer()).get('/project-reports/projects').expect(401)
    const result = await startAndComplete()
    await request(app.getHttpServer()).get('/project-reports/projects').set('Cookie', result.sid).expect(200)
    await request(app.getHttpServer()).post('/project-reports/projects').set('Cookie', result.sid)
      .set('Origin', portal).send({ title: 'Test' }).expect(403)
    await request(app.getHttpServer()).post('/project-reports/projects').set('Cookie', result.sid)
      .set('Origin', 'https://foreign.test').set('X-Work-Tracker-CSRF', result.csrf).send({ title: 'Test' }).expect(403)
    const saved = await request(app.getHttpServer()).post('/project-reports/projects').set('Cookie', result.sid)
      .set('Origin', portal).set('X-Work-Tracker-CSRF', result.csrf).send({ title: 'Test' }).expect(201)
    expect(saved.body.saved).toBe(true)
  })

  it('validates REST DTOs and enforces the allowlist before upstream access', async () => {
    const result = await startAndComplete()
    const before = fetchMock.mock.calls.length
    const rest = () => request(app.getHttpServer()).post('/auth/employee/rest').set('Cookie', result.sid)
      .set('Origin', portal).set('X-Work-Tracker-CSRF', result.csrf)
    await rest().send({ method: 'crm.item.list', params: [], userId: 1 }).expect(400)
    await rest().send({ method: 'crm.item.list', params: { entityTypeId: 9999 } }).expect(403)
    await rest().send({ method: 'user.delete', params: { id: 12 } }).expect(403)
    expect(fetchMock.mock.calls.length).toBe(before)
    await rest().send({ method: 'crm.item.list', params: { entityTypeId: 1072 } }).expect(201)
    expect(fetchMock.mock.calls.length).toBe(before + 1)
  })

  it('revokes the server session on CSRF-checked logout', async () => {
    const result = await startAndComplete()
    await request(app.getHttpServer()).post('/auth/employee/logout').set('Cookie', result.sid).set('Origin', portal).expect(403)
    const logout = await request(app.getHttpServer()).post('/auth/employee/logout').set('Cookie', result.sid)
      .set('Origin', portal).set('X-Work-Tracker-CSRF', result.csrf).expect(204)
    expect(cookies(logout).some((value) => value.startsWith('wt_employee_session=;'))).toBe(true)
    await request(app.getHttpServer()).get('/auth/employee/me').set('Cookie', result.sid).expect(401)
    await request(app.getHttpServer()).get('/project-reports/projects').set('Cookie', result.sid).expect(401)
  })

  it('clears browser cookies after department access was revoked without requiring permission reauthentication', async () => {
    const result = await startAndComplete()
    now += 5 * 60 * 1000
    departmentIds = [40]
    const calls = fetchMock.mock.calls.length
    const logout = await request(app.getHttpServer()).post('/auth/employee/logout').set('Cookie', result.sid)
      .set('Origin', portal).set('X-Work-Tracker-CSRF', result.csrf).expect(204)
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(cookies(logout).some((value) => value.startsWith('wt_employee_session=;'))).toBe(true)
    await request(app.getHttpServer()).get('/project-reports/projects').set('Cookie', result.sid).expect(401)
  })

  it('clears browser cookies after OAuth expiry even when refresh authorization is no longer valid', async () => {
    const result = await startAndComplete()
    now += 61 * 60 * 1000
    fetchMock.mockImplementation(async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }) }) as Response)
    const calls = fetchMock.mock.calls.length
    const logout = await request(app.getHttpServer()).post('/auth/employee/logout').set('Cookie', result.sid)
      .set('Origin', portal).set('X-Work-Tracker-CSRF', result.csrf).expect(204)
    expect(fetchMock.mock.calls.length).toBe(calls)
    expect(cookies(logout).some((value) => value.startsWith('wt_employee_session=;'))).toBe(true)
    await request(app.getHttpServer()).get('/auth/employee/me').set('Cookie', result.sid).expect(401)
  })

  it('clears an already revoked stale cookie on a trusted logout while rejecting cross-site or missing-CSRF requests', async () => {
    const result = await startAndComplete()
    now += 5 * 60 * 1000
    departmentIds = [40]
    await request(app.getHttpServer()).get('/auth/employee/me').set('Cookie', result.sid).expect(403)
    await request(app.getHttpServer()).post('/auth/employee/logout').set('Cookie', result.sid)
      .set('Origin', 'https://foreign.test').set('X-Work-Tracker-CSRF', result.csrf).expect(403)
    await request(app.getHttpServer()).post('/auth/employee/logout').set('Cookie', result.sid).set('Origin', portal).expect(403)
    const logout = await request(app.getHttpServer()).post('/auth/employee/logout').set('Cookie', result.sid)
      .set('Origin', portal).set('X-Work-Tracker-CSRF', result.csrf).expect(204)
    expect(cookies(logout).some((value) => value.startsWith('wt_employee_session=;'))).toBe(true)
  })

  it('authenticates iframe tokens and keeps the same employee cookie/CSRF stable across tabs', async () => {
    const result = await startAndComplete()
    const frame = await request(app.getHttpServer()).post('/auth/employee/frame').set('Cookie', result.sid)
      .set('Origin', portal).send({ accessToken: 'synthetic-frame-token-http' }).expect(200)
    expect(cookie(frame, 'wt_employee_session')).toBe(result.sid)
    expect(frame.body.csrfToken).toBe(result.csrf)
    await request(app.getHttpServer()).post('/auth/employee/frame').set('Origin', 'https://foreign.test')
      .send({ accessToken: 'synthetic-frame-token-http' }).expect(403)
    await request(app.getHttpServer()).post('/auth/employee/frame').set('Origin', portal)
      .send({ accessToken: 'synthetic-frame-token-http', isAdmin: true }).expect(400)
    currentUserId = 88
    const switched = await request(app.getHttpServer()).post('/auth/employee/frame').set('Cookie', result.sid)
      .set('Origin', portal).send({ accessToken: 'synthetic-frame-token-user-88' }).expect(200)
    expect(cookie(switched, 'wt_employee_session')).not.toBe(result.sid)
    expect(switched.body.user.id).toBe(88)
    await request(app.getHttpServer()).get('/project-reports/projects').set('Cookie', result.sid).expect(401)
  })
})
