import 'dotenv/config'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'

const { FRONTEND_URL } = process.env

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true })

  app.enableCors({
    origin: FRONTEND_URL as string,
  })

  await app.listen(process.env.PORT ?? 3001)
  console.log(`Server running on port ${process.env.PORT ?? 3001}`)
}
bootstrap()
