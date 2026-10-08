import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { Observable, throwError } from 'rxjs'
import { catchError, tap } from 'rxjs/operators'

interface HttpLoggingInterceptorOptions {
  isProduction?: boolean
}

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name)
  private readonly isProduction: boolean

  constructor(options: HttpLoggingInterceptorOptions = {}) {
    this.isProduction =
      options.isProduction ??
      (process.env.NODE_ENV === 'production' && process.env.DEV !== 'true')
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const now = Date.now()
    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()
    const requestId = this.getRequestId(request)

    const { method, originalUrl, ip, body, query, params } = request
    const safeOriginalUrl = this.sanitizeUrl(originalUrl)

    response.setHeader('x-request-id', requestId)

    if (this.isProduction) {
      this.logger.log(
        `[REQ] requestId=${requestId} ${method} ${safeOriginalUrl} ip=${ip}`,
      )
    } else {
      this.logger.debug(
        `[REQ] requestId=${requestId} ${method} ${safeOriginalUrl} ip=${ip} query=${this.stringifySafe(query)} params=${this.stringifySafe(params)} body=${this.stringifySafe(body)}`,
      )
      this.logger.verbose(
        `[REQ HEADERS] requestId=${requestId} headers=${this.stringifySafe(request.headers)}`,
      )
    }

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - now
        const message = `[RES] requestId=${requestId} ${method} ${safeOriginalUrl} status=${response.statusCode} +${ms}ms`

        if (response.statusCode >= 400) {
          this.logger.warn(message)
          return
        }

        this.logger.log(message)
      }),
      catchError((error: unknown) => {
        const ms = Date.now() - now
        const statusCode = this.getStatusCode(error, response)
        const message = error instanceof Error ? error.message : 'Unknown error'
        const logMessage = `[ERR] requestId=${requestId} ${method} ${safeOriginalUrl} status=${statusCode} +${ms}ms message=${message}`

        if (statusCode >= 500) {
          this.logger.error(logMessage)
        } else {
          this.logger.warn(logMessage)
        }

        return throwError(() => error)
      }),
    )
  }

  private getRequestId(request: Request): string {
    const header = request.headers['x-request-id']

    if (Array.isArray(header)) {
      return header[0] ?? this.createRequestId()
    }

    return header ?? this.createRequestId()
  }

  private createRequestId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }

  private getStatusCode(error: unknown, response: Response): number {
    if (error instanceof HttpException) {
      return error.getStatus()
    }

    return response.statusCode >= 400 ? response.statusCode : 500
  }

  private stringifySafe(value: unknown): string {
    try {
      const result = JSON.stringify(this.sanitizeValue(value))

      if (!result) {
        return '{}'
      }

      return result.length > 2000 ? `${result.slice(0, 2000)}...` : result
    } catch {
      return '[UNSERIALIZABLE]'
    }
  }

  private sanitizeUrl(url: string): string {
    const [path, rawQuery] = url.split('?', 2)
    if (!rawQuery) return url
    const query = new URLSearchParams(rawQuery)
    query.forEach((_, key) => {
      if (this.isSensitiveKey(key)) query.set(key, '[HIDDEN]')
    })
    return `${path}?${query.toString()}`
  }

  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item))
    }

    if (!value || typeof value !== 'object') {
      return value
    }

    const sanitized: Record<string, unknown> = {}

    for (const [key, nestedValue] of Object.entries(value)) {
      sanitized[key] = this.isSensitiveKey(key)
        ? '[HIDDEN]'
        : this.sanitizeValue(nestedValue)
    }

    return sanitized
  }

  private isSensitiveKey(key: string): boolean {
    const normalizedKey = key.toLowerCase()

    if (['code', 'state', 'auth', 'auth_id', 'refresh_id', 'proof'].includes(normalizedKey)) return true

    return [
      'authorization',
      'cookie',
      'csrf',
      'password',
      'accesstoken',
      'access_token',
      'refreshtoken',
      'refresh_token',
      'token',
      'webhook',
      'client_secret',
      'secret',
    ].some((sensitiveKey) => normalizedKey.includes(sensitiveKey))
  }
}
