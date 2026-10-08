import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request } from 'express'
import { EmployeeAuthService, type ResolvedEmployeeSession } from './employee-auth.service'

export type EmployeeRequest = Request & { employeeSession?: ResolvedEmployeeSession }

export const hasEmployeeRule = (session: ResolvedEmployeeSession, action: string, subject: string): boolean =>
  session.identity.rules.some((rule) => rule.action === action && rule.subject === subject)

/** Match the same permission categories as the application's menus on the server. */
export function canAccessEmployeeApi(session: ResolvedEmployeeSession, path: string, method: string, body?: unknown): boolean {
  const reports = hasEmployeeRule(session, 'read', 'post')
  const clients = hasEmployeeRule(session, 'create-client', 'client')
  if (path === '/auth/employee/rest') return true // The proxy enforces method/entity permissions separately.
  if (/^\/clients(?:\/|$)/.test(path)) return method === 'GET' ? reports || clients : clients
  if (/^\/employee(?:\/|$)/.test(path)) {
    if (reports) return true
    const own = path.match(/^\/employee\/([1-9]\d*)$/)
    return method === 'GET' && !!own && hasEmployeeRule(session, 'read', `employee-${own[1]}`)
  }
  if (path === '/user-sprints/stats' && method === 'POST') {
    if (reports) return true
    const ids = body && typeof body === 'object' && 'userIds' in body ? body.userIds : null
    return Array.isArray(ids) && ids.length > 0 && ids.every((id) =>
      Number(id) === session.identity.user.id && hasEmployeeRule(session, 'read', `employee-${Number(id)}`))
  }
  return reports && /^\/(?:project-reports|gantt|doc-records|support-hours-packages|sprints)(?:\/|$)/.test(path)
}

@Injectable()
export class EmployeeAccessGuard implements CanActivate {
  constructor(private readonly auth: EmployeeAuthService, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true
    const request = context.switchToHttp().getRequest<EmployeeRequest>()
    const path = request.path.toLowerCase().replace(/\/+$/, '') || '/'
    const method = request.method.toUpperCase()
    // Customer routes retain their separate JWT guard; the webhook validates its own secret.
    if ((path === '/health' && method === 'GET') ||
      (path === '/auth/client' && method === 'POST') ||
      /^\/clients\/me(?:\/|$)/.test(path) ||
      /^\/auth\/employee\/(?:login|complete|frame|me|logout)$/.test(path) ||
      (path === '/support-hours-packages/reports/webhook' && ['GET', 'POST'].includes(method))) return true
    // This switch is used only while deploying the paired frontend/backend release.
    if (this.config.get<string>('EMPLOYEE_AUTH_ENFORCE') === 'false' && path !== '/auth/employee/rest') return true

    const token = request.headers['x-bitrix-token']
    const session = typeof token === 'string' && token !== 'employee-session'
      ? await this.auth.resolveIframe(token)
      : await this.auth.resolveSession(request.headers.cookie)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (session.sessionId) {
        this.auth.assertCsrf(request.headers.origin, request.headers['x-work-tracker-csrf'], session)
      } else {
        if (request.headers.origin !== session.identity.portalOrigin) throw new ForbiddenException('Недопустимый источник запроса')
      }
    }
    if (!canAccessEmployeeApi(session, path, method, request.body)) throw new ForbiddenException('У вас нет прав на этот раздел Work Tracker')
    request.employeeSession = session
    // Existing support mutations execute as this employee, never as the server webhook.
    request.headers['x-bitrix-token'] = session.accessToken
    return true
  }
}
