import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { RedisService } from '../shared/redis/redis.service'
import { employeeIdentity } from './employee-access.policy'
import type { CompleteEmployeeLoginDto } from './dto/complete-employee-login.dto'
import type {
  EmployeeIdentity, EmployeeSessionResponse, ResolvedEmployeeSession, StoredEmployeeSession,
} from './employee-auth.types'
export type { EmployeeIdentity, EmployeeSessionResponse, ResolvedEmployeeSession } from './employee-auth.types'

export const EMPLOYEE_SESSION_COOKIE = 'wt_employee_session'
export const EMPLOYEE_STATE_COOKIE = 'wt_employee_oauth_state'
export const EMPLOYEE_COOKIE_PATH = '/devapps/work-tracker/'
const SESSION_SECONDS = 7 * 24 * 60 * 60
const STATE_SECONDS = 5 * 60
const IDENTITY_MS = 5 * 60 * 1000
const TOKEN_BUFFER_MS = 60 * 1000
const FRAME_SECONDS = 50 * 60
const OPAQUE_VALUE = /^[A-Za-z0-9_-]{43}$/
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const opaque = () => randomBytes(32).toString('base64url')
const same = (left: string, right: string) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

type OAuthSettings = {
  portalOrigin: string
  oauthOrigin: string
  redirectUri: string
  clientId: string
  clientSecret: string
  memberId: string
  encryptionKey: Buffer
}
type OAuthTokens = { accessToken: string; refreshToken: string; expiresAt: number; userId: number | null }
type StateRecord = { returnTo: string; createdAt: number }

@Injectable()
export class EmployeeAuthService {
  private readonly inFlight = new Map<string, Promise<ResolvedEmployeeSession>>()
  private departmentCache: { rows: Array<Record<string, unknown>>; checkedAt: number } | null = null
  private departmentInFlight: Promise<Array<Record<string, unknown>>> | null = null
  private readonly iframeIdentities = new Map<string, { identity: EmployeeIdentity; checkedAt: number }>()
  private readonly iframeInFlight = new Map<string, Promise<EmployeeIdentity>>()

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly bitrix: BitrixService,
  ) {}

  private settings(): OAuthSettings {
    try {
      const apiUrl = new URL(this.config.get<string>('API_URL') ?? '')
      if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password) throw new Error()
      const portalOrigin = apiUrl.origin
      const oauthOrigin = this.config.get<string>('BITRIX_OAUTH_ORIGIN') ?? 'https://oauth.bitrix24.tech'
      if (!['https://oauth.bitrix24.tech', 'https://oauth.bitrix.info'].includes(oauthOrigin)) throw new Error()
      const redirectUri = this.config.get<string>('BITRIX_OAUTH_REDIRECT_URI') ?? `${portalOrigin}/devapps/work-tracker`
      const redirect = new URL(redirectUri)
      if (redirect.origin !== portalOrigin || redirect.pathname !== '/devapps/work-tracker' || redirect.search || redirect.hash) throw new Error()
      const clientId = this.config.get<string>('BITRIX_OAUTH_CLIENT_ID') ?? ''
      const clientSecret = this.config.get<string>('BITRIX_OAUTH_CLIENT_SECRET') ?? ''
      const memberId = this.config.get<string>('BITRIX_OAUTH_MEMBER_ID') ?? ''
      const key = this.config.get<string>('BITRIX_OAUTH_SESSION_KEY') ?? ''
      if (!clientId || !clientSecret || !memberId || !/^[a-f\d]{64}$/i.test(key)) throw new Error()
      return { portalOrigin, oauthOrigin, redirectUri, clientId, clientSecret, memberId, encryptionKey: Buffer.from(key, 'hex') }
    } catch {
      throw new ServiceUnavailableException('Вход сотрудников через Битрикс24 ещё не настроен на сервере')
    }
  }

  async beginLogin(returnTo?: string): Promise<{ url: string; state: string }> {
    const settings = this.settings()
    const path = this.returnPath(returnTo)
    const state = opaque()
    await this.redis.setJson(`wt:employee:oauth-state:${hash(state)}`, { returnTo: path, createdAt: Date.now() }, STATE_SECONDS)
    const url = new URL('/oauth/authorize/', settings.portalOrigin)
    url.searchParams.set('client_id', settings.clientId)
    url.searchParams.set('state', state)
    return { url: url.toString(), state }
  }

  async completeLogin(dto: CompleteEmployeeLoginDto, cookieHeader: string | undefined, origin: string | undefined): Promise<{
    session: ResolvedEmployeeSession; returnTo: string
  }> {
    const settings = this.settings()
    this.assertOrigin(origin)
    const cookie = this.cookie(cookieHeader, EMPLOYEE_STATE_COOKIE)
    if (!OPAQUE_VALUE.test(dto.state) || !cookie || !same(cookie, dto.state)) {
      throw new UnauthorizedException('Проверка входа не пройдена. Начните вход через Битрикс24 заново')
    }
    if (dto.domain !== undefined && dto.domain.toLowerCase() !== new URL(settings.portalOrigin).hostname.toLowerCase()) {
      throw new UnauthorizedException('Авторизация получена от другого портала Битрикс24')
    }
    const raw = await this.redis.getDel(`wt:employee:oauth-state:${hash(dto.state)}`)
    let state: StateRecord
    try {
      state = JSON.parse(raw ?? '') as StateRecord
      if (!isRecord(state) || typeof state.returnTo !== 'string' || typeof state.createdAt !== 'number' ||
        Date.now() - state.createdAt > STATE_SECONDS * 1000 || state.createdAt > Date.now() + 5000) throw new Error()
    } catch {
      throw new UnauthorizedException('Время входа истекло или этот вход уже завершён. Начните заново')
    }
    const tokens = await this.exchange('authorization_code', dto.code)
    const identity = await this.verifyIdentity(tokens.accessToken)
    if (tokens.userId !== null && identity.user.id !== tokens.userId) throw new UnauthorizedException('Битрикс24 вернул несогласованные данные пользователя')
    const session = await this.issueSession(tokens, identity, SESSION_SECONDS)
    await this.invalidatePreviousSession(cookieHeader)
    return { session, returnTo: this.returnPath(state.returnTo) }
  }

  /** Bind an embedded frame to the same cookie-guarded API without storing refresh credentials. */
  async createFrameSession(accessToken: string, cookieHeader: string | undefined, origin: string | undefined): Promise<ResolvedEmployeeSession> {
    this.assertOrigin(origin)
    this.validToken(accessToken)
    const { identity } = await this.resolveIframe(accessToken)
    if (this.cookie(cookieHeader, EMPLOYEE_SESSION_COOKIE)) {
      try {
        const existing = await this.resolveSession(cookieHeader)
        // All tabs share this host cookie. Keep the existing SID and CSRF token
        // when an iframe opens beside a standalone window of the same employee.
        // A full OAuth session also keeps its server-held refresh credentials.
        if (existing.identity.user.id === identity.user.id) return existing
      } catch (error) {
        if (!(error instanceof UnauthorizedException) && !(error instanceof ForbiddenException)) throw error
      }
    }
    const session = await this.issueSession({ accessToken, refreshToken: '', expiresAt: Date.now() + FRAME_SECONDS * 1000, userId: identity.user.id }, identity, FRAME_SECONDS)
    await this.invalidatePreviousSession(cookieHeader)
    return session
  }

  response(session: ResolvedEmployeeSession): EmployeeSessionResponse {
    return { ...session.identity, csrfToken: session.csrfToken, expiresAt: new Date(session.expiresAt).toISOString() }
  }

  async resolveSession(cookieHeader: string | undefined): Promise<ResolvedEmployeeSession> {
    const id = this.cookie(cookieHeader, EMPLOYEE_SESSION_COOKIE)
    if (!id || !OPAQUE_VALUE.test(id)) throw new UnauthorizedException('Войдите в Work Tracker через Битрикс24')
    const key = this.sessionKey(id)
    const pending = this.inFlight.get(key)
    if (pending) return pending
    const promise = this.loadAndRefresh(id)
    this.inFlight.set(key, promise)
    try { return await promise } finally { if (this.inFlight.get(key) === promise) this.inFlight.delete(key) }
  }

  async resolveIframe(token: string | undefined): Promise<ResolvedEmployeeSession> {
    this.settings()
    this.validToken(token)
    const key = hash(token)
    const existing = this.iframeIdentities.get(key)
    const identity = existing && Date.now() - existing.checkedAt < IDENTITY_MS
      ? existing.identity : await this.resolveIframeIdentity(token, key)
    return { accessToken: token, identity, csrfToken: '', sessionId: '', expiresAt: Date.now() + IDENTITY_MS }
  }

  private async resolveIframeIdentity(token: string, key: string): Promise<EmployeeIdentity> {
    const existing = this.iframeInFlight.get(key)
    if (existing) return await existing
    if (this.iframeInFlight.size >= 500) throw new ServiceUnavailableException('Авторизация временно занята. Повторите запрос через несколько секунд')
    const pending = this.verifyIdentity(token).then((identity) => {
      if (this.iframeIdentities.size >= 500) this.iframeIdentities.clear()
      this.iframeIdentities.set(key, { identity, checkedAt: this.identityCheckedAt() })
      return identity
    })
    this.iframeInFlight.set(key, pending)
    try { return await pending } finally {
      if (this.iframeInFlight.get(key) === pending) this.iframeInFlight.delete(key)
    }
  }

  assertOrigin(origin: string | undefined): void {
    if (origin !== this.settings().portalOrigin) throw new ForbiddenException('Действие разрешено только со страницы Work Tracker')
  }

  assertCsrf(origin: string | undefined, csrfHeader: string | string[] | undefined, session: ResolvedEmployeeSession): void {
    this.assertOrigin(origin)
    if (typeof csrfHeader !== 'string' || !OPAQUE_VALUE.test(csrfHeader) || !same(csrfHeader, session.csrfToken)) {
      throw new ForbiddenException('Проверка сессии не пройдена. Обновите Work Tracker перед повторной попыткой')
    }
  }

  async logout(session: ResolvedEmployeeSession): Promise<void> {
    if (session.sessionId) await this.redis.del(this.sessionKey(session.sessionId))
  }

  /** Logout must remain available after upstream access or OAuth credentials are revoked. */
  async logoutFromCookie(cookieHeader: string | undefined, origin: string | undefined, csrfHeader: string | string[] | undefined): Promise<void> {
    this.assertOrigin(origin)
    const id = this.cookie(cookieHeader, EMPLOYEE_SESSION_COOKIE)
    if (!id || typeof csrfHeader !== 'string' || !OPAQUE_VALUE.test(csrfHeader)) {
      throw new ForbiddenException('Проверка сессии не пройдена. Обновите Work Tracker перед повторной попыткой')
    }
    const raw = await this.redis.get(this.sessionKey(id))
    if (!raw) {
      // The server has already expired/revoked this opaque SID. There is no
      // session left to mutate; clear only this browser's stale login cookies.
      return
    }
    const record = this.decrypt(raw)
    this.assertCsrf(origin, csrfHeader, this.resolved(id, record))
    await this.redis.del(this.sessionKey(id))
  }

  /** Permission allowlists belong to the controller/guard; this transport pins the portal and identity. */
  async callRest(session: ResolvedEmployeeSession, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!/^[a-z][a-z0-9_.]{0,99}$/i.test(method) || !isRecord(params)) throw new BadRequestException('Некорректный метод Битрикс24')
    // Never accept credentials or endpoints hidden inside caller parameters.
    for (const key of Object.keys(params)) {
      if (['auth', 'access_token', 'refresh_token', 'domain', 'client_endpoint', 'server_endpoint'].includes(key.toLowerCase())) {
        throw new BadRequestException('Передавать параметры авторизации Битрикс24 запрещено')
      }
    }
    return await this.restResponse(session.accessToken, method, params)
  }

  private returnPath(value?: string): string {
    if (value === undefined || value === '') return '/reports/calendar'
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') ||
      value.includes('\\') || [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) ||
      value.split(/[/?#]/).includes('..')) {
      throw new BadRequestException('Некорректная страница для возврата после входа')
    }
    return value
  }

  private cookie(header: string | undefined, name: string): string | null {
    if (!header) return null
    const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`))
    if (values.length !== 1) return null
    const value = values[0].slice(name.length + 1)
    return OPAQUE_VALUE.test(value) ? value : null
  }

  private sessionKey(id: string) { return `wt:employee:session:${hash(id)}` }

  private encrypt(record: StoredEmployeeSession): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.settings().encryptionKey, iv)
    cipher.setAAD(Buffer.from('work-tracker:employee-session:v1'))
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')
  }

  private decrypt(raw: string): StoredEmployeeSession {
    try {
      const packed = Buffer.from(raw, 'base64url')
      if (packed.length <= 28) throw new Error()
      const decipher = createDecipheriv('aes-256-gcm', this.settings().encryptionKey, packed.subarray(0, 12))
      decipher.setAAD(Buffer.from('work-tracker:employee-session:v1'))
      decipher.setAuthTag(packed.subarray(12, 28))
      const value: unknown = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'))
      if (!isRecord(value) || value.version !== 1 || typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' ||
        typeof value.userId !== 'number' || !Number.isSafeInteger(value.userId) || value.userId <= 0 ||
        typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) ||
        typeof value.tokenExpiresAt !== 'number' || !Number.isFinite(value.tokenExpiresAt) ||
        typeof value.csrfToken !== 'string' || !OPAQUE_VALUE.test(value.csrfToken) ||
        typeof value.identityCheckedAt !== 'number' || !isRecord(value.identity)) throw new Error()
      return value as StoredEmployeeSession
    } catch {
      throw new UnauthorizedException('Сессия Work Tracker недействительна. Войдите заново')
    }
  }

  private async issueSession(tokens: OAuthTokens, identity: EmployeeIdentity, seconds: number): Promise<ResolvedEmployeeSession> {
    const id = opaque()
    const record: StoredEmployeeSession = {
      version: 1, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, tokenExpiresAt: tokens.expiresAt,
      userId: identity.user.id, expiresAt: Date.now() + seconds * 1000, csrfToken: opaque(), identity, identityCheckedAt: this.identityCheckedAt(),
    }
    await this.redis.set(this.sessionKey(id), this.encrypt(record), seconds)
    return this.resolved(id, record)
  }

  private async invalidatePreviousSession(header: string | undefined): Promise<void> {
    const id = this.cookie(header, EMPLOYEE_SESSION_COOKIE)
    if (id) await this.redis.del(this.sessionKey(id))
  }

  private resolved(id: string, record: StoredEmployeeSession): ResolvedEmployeeSession {
    return { accessToken: record.accessToken, identity: record.identity, csrfToken: record.csrfToken, sessionId: id, expiresAt: record.expiresAt }
  }

  private async loadAndRefresh(id: string): Promise<ResolvedEmployeeSession> {
    this.settings()
    const key = this.sessionKey(id)
    let raw = await this.redis.get(key)
    if (!raw) throw new UnauthorizedException('Сессия истекла. Войдите в Work Tracker через Битрикс24')
    let record = this.decrypt(raw)
    if (record.expiresAt <= Date.now()) {
      await this.redis.del(key)
      throw new UnauthorizedException('Сессия истекла. Войдите заново')
    }
    if (record.tokenExpiresAt > Date.now() + TOKEN_BUFFER_MS && Date.now() - record.identityCheckedAt < IDENTITY_MS) return this.resolved(id, record)
    const owner = opaque()
    const lockKey = `${key}:refresh-lock`
    let locked = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await this.redis.acquireLock(lockKey, owner, 60)) { locked = true; break }
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
    if (!locked) throw new ServiceUnavailableException('Сессия уже обновляется. Повторите запрос через несколько секунд')
    try {
      raw = await this.redis.get(key)
      if (!raw) throw new UnauthorizedException('Сессия завершена. Войдите заново')
      record = this.decrypt(raw)
      const persist = async () => {
        const ttl = Math.ceil((record.expiresAt - Date.now()) / 1000)
        if (ttl <= 0) throw new UnauthorizedException('Сессия истекла. Войдите заново')
        const updated = this.encrypt(record)
        if (!await this.redis.compareAndSet(key, raw as string, updated, ttl)) throw new UnauthorizedException('Сессия завершена. Войдите заново')
        raw = updated
      }
      if (record.tokenExpiresAt <= Date.now() + TOKEN_BUFFER_MS) {
        if (!record.refreshToken) throw new UnauthorizedException('Сессия Битрикс24 истекла. Обновите приложение')
        const tokens = await this.exchange('refresh_token', record.refreshToken)
        if (tokens.userId !== null && tokens.userId !== record.userId) throw new UnauthorizedException('Пользователь обновлённой сессии не совпадает')
        record.accessToken = tokens.accessToken
        record.refreshToken = tokens.refreshToken
        record.tokenExpiresAt = tokens.expiresAt
        // Persist rotated refresh credentials before another fallible upstream lookup.
        record.identityCheckedAt = 0
        await persist()
      }
      if (Date.now() - record.identityCheckedAt >= IDENTITY_MS) {
        const identity = await this.verifyIdentity(record.accessToken)
        if (identity.user.id !== record.userId) throw new UnauthorizedException('Пользователь сессии не совпадает')
        record.identity = identity
        record.identityCheckedAt = this.identityCheckedAt()
        await persist()
      }
      return this.resolved(id, record)
    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) await this.redis.del(key)
      throw error
    } finally {
      await this.redis.releaseLock(lockKey, owner)
    }
  }

  private async departments(): Promise<Array<Record<string, unknown>>> {
    if (this.departmentCache && Date.now() - this.departmentCache.checkedAt < IDENTITY_MS) return this.departmentCache.rows
    if (this.departmentInFlight) return await this.departmentInFlight
    const pending = this.bitrix.listDepartments().then((rows) => {
      this.departmentCache = { rows, checkedAt: Date.now() }
      return rows
    })
    this.departmentInFlight = pending
    try { return await pending } finally {
      if (this.departmentInFlight === pending) this.departmentInFlight = null
    }
  }

  private identityCheckedAt(): number {
    // A cached hierarchy must not extend a permission grant for another five minutes.
    return Math.min(Date.now(), this.departmentCache?.checkedAt ?? Date.now())
  }

  private async verifyIdentity(token: string): Promise<EmployeeIdentity> {
    const [user, admin, departments] = await Promise.all([
      this.restResponse(token, 'user.current', {}),
      this.restResponse(token, 'user.admin', {}),
      this.departments(),
    ])
    if (!isRecord(user.result) || typeof admin.result !== 'boolean') throw new BadGatewayException('Битрикс24 не подтвердил данные сотрудника')
    return employeeIdentity(user.result, admin.result, departments, this.settings().portalOrigin)
  }

  private validToken(token: unknown): asserts token is string {
    if (typeof token !== 'string' || !token.length || token.length > 4096 || /[^\x21-\x7e]/.test(token)) {
      throw new UnauthorizedException('Авторизация Битрикс24 отсутствует или недействительна')
    }
  }

  private async exchange(grant: 'authorization_code' | 'refresh_token', value: string): Promise<OAuthTokens> {
    const settings = this.settings()
    const body = new URLSearchParams({
      grant_type: grant, client_id: settings.clientId, client_secret: settings.clientSecret,
      [grant === 'authorization_code' ? 'code' : 'refresh_token']: value,
      ...(grant === 'authorization_code' ? { redirect_uri: settings.redirectUri } : {}),
    })
    const result = await this.request(`${settings.oauthOrigin}/oauth/token/`, body.toString(), 'application/x-www-form-urlencoded')
    const expectedEndpoint = `${settings.portalOrigin}/rest/`
    const userId = result.user_id == null ? null : Number(result.user_id)
    const expires = Number(result.expires_in)
    if (result.member_id !== settings.memberId || result.client_endpoint !== expectedEndpoint ||
      (result.server_endpoint != null && result.server_endpoint !== `${settings.oauthOrigin}/rest/`) ||
      typeof result.access_token !== 'string' || typeof result.refresh_token !== 'string' ||
      !Number.isFinite(expires) || expires < 60 || expires > 86400 ||
      (userId !== null && (!Number.isSafeInteger(userId) || userId <= 0))) {
      throw new UnauthorizedException('Получена авторизация другого портала или некорректная сессия Битрикс24')
    }
    this.validToken(result.access_token)
    this.validToken(result.refresh_token)
    return { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + expires * 1000, userId }
  }

  private async restResponse(token: string, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.validToken(token)
    return await this.request(`${this.settings().portalOrigin}/rest/${method}.json`, JSON.stringify({ ...params, auth: token }), 'application/json', true)
  }

  private async request(url: string, body: string, contentType: string, requireResult = false): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': contentType, Accept: 'application/json' }, body,
        redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new BadGatewayException('Битрикс24 не ответил. Проверьте результат действия перед повторной попыткой')
    }
    if (response.status >= 300 && response.status < 400) throw new BadGatewayException('Битрикс24 вернул неожиданное перенаправление')
    let value: unknown
    try { value = await response.json() } catch { throw new BadGatewayException('Битрикс24 вернул некорректный ответ') }
    const error = isRecord(value) && typeof value.error === 'string' ? value.error.toUpperCase() : ''
    if (['EXPIRED_TOKEN', 'INVALID_TOKEN', 'NO_AUTH_FOUND', 'INVALID_CREDENTIALS', 'INVALID_GRANT', 'ERROR_OAUTH'].includes(error) || response.status === 401) {
      throw new UnauthorizedException('Сессия Битрикс24 истекла или недействительна. Войдите заново')
    }
    if (['ACCESS_DENIED', 'ERROR_ACCESS_DENIED', 'INSUFFICIENT_SCOPE', 'USER_ACCESS_ERROR', 'ALLOWED_ONLY_INTRANET_USER'].includes(error) || response.status === 403) {
      throw new ForbiddenException('У сотрудника или приложения нет доступа к этому действию в Битрикс24')
    }
    if (!response.ok || !isRecord(value) || Object.hasOwn(value, 'error') || (requireResult && !Object.hasOwn(value, 'result'))) {
      // No upstream descriptions or request configuration: they can contain OAuth secrets.
      throw new BadGatewayException('Битрикс24 не подтвердил действие. Проверьте данные перед повторной попыткой')
    }
    return value
  }
}
