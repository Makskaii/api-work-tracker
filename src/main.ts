import 'dotenv/config'
import { Logger, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter'
import { HttpLoggingInterceptor } from './shared/interceptors/http-logging.interceptor'
import {
  getNestLoggerLevels,
  isProductionEnvironment,
} from './shared/logging/logging.config'

const { FRONTEND_URL } = process.env

async function bootstrap() {
  const isProduction = isProductionEnvironment(process.env.NODE_ENV, process.env.DEV)
  const app = await NestFactory.create(AppModule, {
    cors: true,
    logger: getNestLoggerLevels(process.env.NODE_ENV, process.env.DEV),
  })

  app.enableCors({
    origin: FRONTEND_URL as string,
  })

  const port = Number(process.env.PORT) || 3001

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )

  app.useGlobalInterceptors(new HttpLoggingInterceptor({ isProduction }))
  app.useGlobalFilters(new AllExceptionsFilter())

  const logger = new Logger('Bootstrap')
  await app.listen(port)
  logger.log(`Application started on port ${port}`)
}
bootstrap()
