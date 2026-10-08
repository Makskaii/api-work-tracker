import { BadGatewayException, BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { EntityTypeIds } from '../constants/const'
import { hasEmployeeRule } from './employee-access.guard'
import { EmployeeAuthService, type ResolvedEmployeeSession } from './employee-auth.service'

const READ_METHODS = new Set([
  'user.get', 'department.get', 'crm.status.list', 'lists.element.get',
  'crm.item.fields', 'crm.item.list', 'crm.item.get', 'crm.deal.list',
  'crm.company.list', 'crm.company.get', 'voximplant.statistic.get',
  'tasks.task.list', 'sonet_group.get',
])
const WRITE_METHODS = new Set(['crm.item.add', 'crm.item.update'])
const ENTITIES = new Set<number>([...Object.values(EntityTypeIds), 1140, 1144])
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function assertEmployeeRestPermission(session: ResolvedEmployeeSession, method: string, params: Record<string, unknown>): void {
  if (method === 'user.current' || method === 'department.get') return
  const reports = hasEmployeeRule(session, 'read', 'post')
  const sales = hasEmployeeRule(session, 'read', 'sales-report')
  const clients = hasEmployeeRule(session, 'create-client', 'client')
  if (!READ_METHODS.has(method) && !WRITE_METHODS.has(method)) throw new ForbiddenException('Этот метод Битрикс24 недоступен в Work Tracker')
  if (method.startsWith('crm.item.')) {
    const entity = Number(params.entityTypeId)
    if (!Number.isSafeInteger(entity) || !ENTITIES.has(entity)) throw new ForbiddenException('Этот смарт-процесс недоступен в Work Tracker')
    if (WRITE_METHODS.has(method)) {
      if (!reports || ![EntityTypeIds.tasks, EntityTypeIds.reports].includes(entity)) throw new ForbiddenException('Нет прав на изменение задач и отчётов')
    } else if (!reports && !(sales && entity === EntityTypeIds.default) && !(clients && entity === EntityTypeIds.companies)) {
      throw new ForbiddenException('Нет прав на этот смарт-процесс')
    }
  } else if (!reports) {
    const common = ['department.get', 'user.get', 'crm.status.list'].includes(method)
    const salesData = sales && ['crm.deal.list', 'voximplant.statistic.get'].includes(method)
    const companyData = clients && ['crm.company.list', 'crm.company.get'].includes(method)
    if (!((sales || clients) && common) && !salesData && !companyData) throw new ForbiddenException('Нет прав на эти данные')
  }
}

@Injectable()
export class EmployeeRestService {
  constructor(private readonly auth: EmployeeAuthService, private readonly config: ConfigService) {}

  async call(session: ResolvedEmployeeSession, method: string, params: unknown): Promise<Record<string, unknown>> {
    if (!isRecord(params) || Object.hasOwn(params, 'auth') || Object.hasOwn(params, 'access_token') || Object.hasOwn(params, 'callback')) {
      throw new BadRequestException('Недопустимые параметры запроса Битрикс24')
    }
    assertEmployeeRestPermission(session, method, params)
    if (method === 'user.current' || WRITE_METHODS.has(method)) return this.auth.callRest(session, method, params)
    // Report reads retain the application's existing cross-employee scope. The
    // privileged integration credential remains exclusively on the server.
    const base = this.config.get<string>('API_URL')
    let url: URL
    try {
      url = new URL(`${method}.json`, base?.endsWith('/') ? base : `${base}/`)
      if (url.protocol !== 'https:' || url.origin !== session.identity.portalOrigin || url.username || url.password) throw new Error('Invalid integration')
    } catch { throw new BadGatewayException('Не настроено подключение Work Tracker к Битрикс24') }
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(params), redirect: 'manual', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(25_000),
      })
    } catch { throw new BadGatewayException('Битрикс24 временно недоступен. Повторите загрузку') }
    let data: unknown
    try { data = await response.json() } catch { throw new BadGatewayException('Битрикс24 вернул некорректный ответ') }
    if (!response.ok || !isRecord(data) || Object.hasOwn(data, 'error') || !Object.hasOwn(data, 'result')) {
      // Do not expose fetch causes, upstream descriptions, or credential URLs.
      throw new BadGatewayException('Не удалось получить данные из Битрикс24')
    }
    return data
  }
}
