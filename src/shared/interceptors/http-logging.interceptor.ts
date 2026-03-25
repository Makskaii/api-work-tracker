import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { Observable, throwError } from 'rxjs'
import { catchError, tap } from 'rxjs/operators'

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name)

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const now = Date.now()

    if (context.getType() !== 'http') {
      return next.handle()
    }

    const request = context.switchToHttp().getRequest<Request>()
    const response = context.switchToHttp().getResponse<Response>()

    const { method, originalUrl, ip, body, query, params } = request

    this.logger.log(
      `[REQ] ${method} ${originalUrl} ip=${ip} query=${JSON.stringify(query)} params=${JSON.stringify(params)}`,
    )

    if (body && Object.keys(body).length > 0) {
      const safeBody = this.sanitizeBody(body)
      this.logger.debug(
        `[REQ BODY] ${method} ${originalUrl} body=${JSON.stringify(safeBody)}`,
      )
    }

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - now
        this.logger.log(
          `[RES] ${method} ${originalUrl} status=${response.statusCode} +${ms}ms`,
        )
      }),
      catchError((error: unknown) => {
        const ms = Date.now() - now
        const message = error instanceof Error ? error.message : 'Unknown error'

        this.logger.error(
          `[ERR] ${method} ${originalUrl} status=${response.statusCode} +${ms}ms message=${message}`,
        )

        return throwError(() => error)
      }),
    )
  }

  private sanitizeBody(body: Record<string, unknown>) {
    const cloned = { ...body }

    const hiddenFields = ['password', 'accessToken', 'refreshToken', 'token']

    for (const key of hiddenFields) {
      if (key in cloned) {
        cloned[key] = '[HIDDEN]'
      }
    }

    return cloned
  }
}
