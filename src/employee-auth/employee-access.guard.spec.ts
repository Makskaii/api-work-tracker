import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { canAccessEmployeeApi, EmployeeAccessGuard, type EmployeeRequest } from './employee-access.guard'
import { EmployeeAuthService, type ResolvedEmployeeSession } from './employee-auth.service'

const session = (rules = [{ action: 'read', subject: 'post' }]): ResolvedEmployeeSession => ({
  identity: { user: { id: 42, name: 'Test', departmentIds: [23], isAdmin: false }, rules, portalOrigin: 'https://portal.example.test' },
  accessToken: 'server-only-token', csrfToken: 'csrf', sessionId: 'opaque', expiresAt: Date.now() + 60_000,
})
const request = (path: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown) =>
  ({ path, method, headers, body }) as unknown as EmployeeRequest
const context = (req: EmployeeRequest) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext

describe('employee API authorization', () => {
  const reports = session()
  const sales = session([{ action: 'read', subject: 'sales-report' }, { action: 'create-client', subject: 'client' }])
  const own = session([{ action: 'read', subject: 'employee-42' }])

  it('keeps sales access separate from project/support/employee reports', () => {
    expect(canAccessEmployeeApi(sales, '/clients', 'GET')).toBe(true)
    expect(canAccessEmployeeApi(sales, '/clients/7', 'PATCH')).toBe(true)
    for (const path of ['/support-hours-packages', '/project-reports/projects', '/gantt/projects/1/events', '/employee', '/sprints/sync']) {
      expect(canAccessEmployeeApi(sales, path, 'GET')).toBe(false)
    }
  })
  it('prevents development staff without client-management rights from editing client budgets', () => {
    expect(canAccessEmployeeApi(reports, '/clients', 'GET')).toBe(true)
    expect(canAccessEmployeeApi(reports, '/clients/5/purchased-hours', 'POST')).toBe(false)
    expect(canAccessEmployeeApi(reports, '/support-hours-packages/12/report', 'POST')).toBe(true)
  })
  it('restricts individual statistics to the same employee, including POST body lists', () => {
    expect(canAccessEmployeeApi(own, '/employee/42', 'GET')).toBe(true)
    expect(canAccessEmployeeApi(own, '/employee/41', 'GET')).toBe(false)
    expect(canAccessEmployeeApi(own, '/employee/42', 'POST')).toBe(false)
    expect(canAccessEmployeeApi(own, '/user-sprints/stats', 'POST', { userIds: [42] })).toBe(true)
    expect(canAccessEmployeeApi(own, '/user-sprints/stats', 'POST', { userIds: [42, 41] })).toBe(false)
    expect(canAccessEmployeeApi(own, '/user-sprints/stats', 'POST', { userIds: [] })).toBe(false)
    expect(canAccessEmployeeApi(reports, '/unknown/admin', 'POST')).toBe(false)
  })

  const mockAuth = {
    resolveSession: jest.fn(), resolveIframe: jest.fn(), assertCsrf: jest.fn(),
  }
  const guard = new EmployeeAccessGuard(mockAuth as unknown as EmployeeAuthService, new ConfigService({ EMPLOYEE_AUTH_ENFORCE: 'true' }))
  beforeEach(() => { jest.clearAllMocks(); mockAuth.resolveSession.mockResolvedValue(reports); mockAuth.resolveIframe.mockResolvedValue({ ...reports, sessionId: '' }) })

  it('does not replace existing customer JWT/webhook/health guards', async () => {
    for (const [path, method] of [['/health', 'GET'], ['/auth/client', 'POST'], ['/clients/me/tasks', 'GET'], ['/support-hours-packages/reports/webhook', 'POST']]) {
      await expect(guard.canActivate(context(request(path, method)))).resolves.toBe(true)
    }
    expect(mockAuth.resolveSession).not.toHaveBeenCalled()
  })
  it('does not allow a missing employee session to access staff data', async () => {
    mockAuth.resolveSession.mockRejectedValue(new UnauthorizedException())
    await expect(guard.canActivate(context(request('/project-reports/projects')))).rejects.toBeInstanceOf(UnauthorizedException)
  })
  it('injects the server-held employee token and enforces cookie CSRF before a support mutation', async () => {
    const req = request('/support-hours-packages/projects/1/transfers', 'POST', { cookie: 'session', origin: reports.identity.portalOrigin, 'x-work-tracker-csrf': 'csrf', 'x-bitrix-token': 'employee-session' })
    await expect(guard.canActivate(context(req))).resolves.toBe(true)
    expect(mockAuth.assertCsrf).toHaveBeenCalledWith(reports.identity.portalOrigin, 'csrf', reports)
    expect(req.headers['x-bitrix-token']).toBe('server-only-token')
    expect(req.employeeSession).toBe(reports)
  })
  it('rejects unauthorized departments even when they supply a valid employee cookie', async () => {
    mockAuth.resolveSession.mockResolvedValue(sales)
    await expect(guard.canActivate(context(request('/project-reports/projects')))).rejects.toBeInstanceOf(ForbiddenException)
  })
  it('allows verified iframe tokens only from the portal for writes', async () => {
    await expect(guard.canActivate(context(request('/sprints/sync', 'POST', { 'x-bitrix-token': 'iframe-oauth', origin: 'https://evil.example' })))).rejects.toBeInstanceOf(ForbiddenException)
    await expect(guard.canActivate(context(request('/sprints/sync', 'POST', { 'x-bitrix-token': 'iframe-oauth', origin: reports.identity.portalOrigin })))).resolves.toBe(true)
    expect(mockAuth.resolveIframe).toHaveBeenCalledWith('iframe-oauth')
  })
  it('enforces authentication by default when no rollout switch is configured', async () => {
    mockAuth.resolveSession.mockRejectedValue(new UnauthorizedException())
    const defaultGuard = new EmployeeAccessGuard(mockAuth as unknown as EmployeeAuthService, new ConfigService())
    await expect(defaultGuard.canActivate(context(request('/employee')))).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
