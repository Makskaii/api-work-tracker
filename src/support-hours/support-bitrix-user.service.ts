import {
  BadGatewayException, BadRequestException, ForbiddenException, GatewayTimeoutException,
  HttpException, HttpStatus, Injectable, InternalServerErrorException, NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { DailyReportCodes, Endpoints, EntityTypeIds } from '../constants/const'

export type SupportBitrixUser = { id: number }
export type SupportBitrixItem = Record<string, unknown> & { id: number | string }
type UserMethod = 'user.current' | typeof Endpoints.item | typeof Endpoints.crmItemUpdate

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const positiveId = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
const checked = (value: unknown): boolean | null => {
  if (value === true || value === 1 || value === '1' || value === 'Y') return true
  if (value === false || value === 0 || value === '0' || value === 'N') return false
  return null
}

@Injectable()
export class SupportBitrixUserService {
  private readonly origin: string

  constructor(config: ConfigService) {
    try {
      const url = new URL(config.get<string>('API_URL') ?? '')
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid portal origin')
      // Strip the configured privileged webhook path. No caller-provided URL is accepted.
      this.origin = url.origin
    } catch {
      throw new InternalServerErrorException('Не настроено защищённое подключение к порталу Битрикс24')
    }
  }

  async verifyUser(token: string | undefined): Promise<SupportBitrixUser> {
    const result = await this.call(token, 'user.current', {})
    const id = isRecord(result) ? positiveId(result.ID) : null
    if (id === null) throw new BadGatewayException('Битрикс24 не подтвердил текущего пользователя')
    if (isRecord(result) && checked(result.ACTIVE) === false) throw new ForbiddenException('Пользователь Битрикс24 неактивен')
    return { id }
  }

  async getItem<T extends SupportBitrixItem = SupportBitrixItem>(token: string | undefined, entityTypeId: number, id: number): Promise<T> {
    this.validateItem(entityTypeId, id)
    await this.verifyUser(token)
    return await this.readItem(token, entityTypeId, id) as T
  }

  async setReportAccounting(token: string | undefined, id: number, enabled: boolean): Promise<{ id: number; includeInPackage: boolean }> {
    this.validateItem(EntityTypeIds.reports, id)
    if (typeof enabled !== 'boolean') throw new BadRequestException('Признак учёта отчёта должен быть логическим значением')
    await this.verifyUser(token)
    const result = await this.call(token, Endpoints.crmItemUpdate, {
      entityTypeId: EntityTypeIds.reports, id, useOriginalUfNames: 'N',
      fields: { [DailyReportCodes.includeInPackage]: enabled ? 'Y' : 'N' },
    })
    this.itemFromResult(result, id)
    // Confirm persistence through the same user's permissions, not the server webhook.
    const item = await this.readItem(token, EntityTypeIds.reports, id)
    if (checked(item[DailyReportCodes.includeInPackage]) !== enabled) {
      throw new BadGatewayException('Не удалось подтвердить изменение учёта отчёта в Битрикс24. Обновите данные перед повторной попыткой')
    }
    return { id, includeInPackage: enabled }
  }

  private validateItem(entityTypeId: number, id: number): void {
    if (entityTypeId !== EntityTypeIds.tasks && entityTypeId !== EntityTypeIds.reports) {
      throw new BadRequestException('Разрешены только задачи и отчёты техподдержки')
    }
    if (positiveId(id) === null) throw new BadRequestException('Укажите корректный номер элемента Битрикс24')
  }

  private async readItem(token: string | undefined, entityTypeId: number, id: number): Promise<SupportBitrixItem> {
    return this.itemFromResult(await this.call(token, Endpoints.item, { entityTypeId, id, useOriginalUfNames: 'N' }), id)
  }

  private itemFromResult(result: unknown, id: number): SupportBitrixItem {
    const item = isRecord(result) ? result.item : null
    if (!isRecord(item) || positiveId(item.id) !== id) throw new BadGatewayException('Битрикс24 вернул некорректный элемент')
    return item as SupportBitrixItem
  }

  private async call(token: string | undefined, method: UserMethod, params: Record<string, unknown>): Promise<unknown> {
    if (!['user.current', Endpoints.item, Endpoints.crmItemUpdate].includes(method)) throw new BadRequestException('Недопустимый метод Битрикс24')
    if (typeof token !== 'string' || !token.length || token.length > 4096 || /[^\x21-\x7E]/.test(token)) {
      throw new UnauthorizedException('Откройте Work Tracker в Битрикс24 и повторите действие')
    }
    let response: Response
    try {
      response = await fetch(`${this.origin}/rest/${method}.json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        // OAuth uses the auth body parameter. Tokens are never placed in URLs or retained in this service.
        body: JSON.stringify({ ...params, auth: token }),
        credentials: 'omit', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      if (isRecord(error) && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new GatewayTimeoutException('Битрикс24 не ответил вовремя. Проверьте результат операции перед повторной попыткой')
      }
      throw new BadGatewayException('Не удалось связаться с Битрикс24. Проверьте результат операции перед повторной попыткой')
    }
    if (response.status >= 300 && response.status < 400) throw new BadGatewayException('Битрикс24 вернул неожиданное перенаправление')
    let body: unknown
    try { body = await response.json() } catch { this.upstreamError(response.status) }
    if (!response.ok || (isRecord(body) && Object.hasOwn(body, 'error'))) {
      this.upstreamError(response.status, isRecord(body) ? body.error : undefined)
    }
    if (!isRecord(body) || !Object.hasOwn(body, 'result')) throw new BadGatewayException('Битрикс24 вернул некорректный ответ')
    return body.result
  }

  private upstreamError(status: number, error?: unknown): never {
    // Never expose upstream descriptions, fetch error causes, or request configuration containing OAuth secrets.
    const code = typeof error === 'string' ? error.toUpperCase() : ''
    if (['ACCESS_DENIED', 'ERROR_ACCESS_DENIED', 'INSUFFICIENT_SCOPE', 'USER_ACCESS_ERROR', 'ALLOWED_ONLY_INTRANET_USER', 'UPDATE_DYNAMIC_ITEM_RESTRICTED'].includes(code) || status === 403) {
      throw new ForbiddenException('У текущего пользователя нет доступа к этому действию в Битрикс24')
    }
    if (['EXPIRED_TOKEN', 'INVALID_TOKEN', 'NO_AUTH_FOUND', 'INVALID_CREDENTIALS'].includes(code) || status === 401) {
      throw new UnauthorizedException('Сессия Битрикс24 истекла или недействительна. Обновите приложение')
    }
    if (['NOT_FOUND', 'ERROR_NOT_FOUND', 'ERROR_ITEM_NOT_FOUND'].includes(code)) throw new NotFoundException('Элемент Битрикс24 не найден')
    if (['QUERY_LIMIT_EXCEEDED', 'OPERATION_TIME_LIMIT'].includes(code) || status === 429) {
      throw new HttpException('Битрикс24 временно ограничил запросы. Повторите действие позже', HttpStatus.TOO_MANY_REQUESTS)
    }
    throw new BadGatewayException('Битрикс24 не подтвердил операцию. Проверьте данные и результат перед повторной попыткой')
  }
}
