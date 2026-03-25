import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') {
      throw exception
    }

    const ctx = host.switchToHttp()
    const request = ctx.getRequest<Request>()
    const response = ctx.getResponse<Response>()

    const isHttpException = exception instanceof HttpException

    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR

    const exceptionResponse = isHttpException ? exception.getResponse() : null

    const message =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
        ? exceptionResponse['message']
        : exception instanceof Error
          ? exception.message
          : 'Internal server error'

    const stack = exception instanceof Error ? exception.stack : undefined

    this.logger.error(
      `HTTP ${request.method} ${request.originalUrl} ${status} - ${JSON.stringify(message)}`,
      stack,
    )

    response.status(status).json({
      statusCode: status,
      path: request.originalUrl,
      method: request.method,
      timestamp: new Date().toISOString(),
      message,
    })
  }
}
