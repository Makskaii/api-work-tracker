import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { BitrixService } from './bitrix.service'

const { API_URL } = process.env

@Module({
  imports: [
    HttpModule.register({
      baseURL: API_URL,
      timeout: 5000,
    }),
  ],
  providers: [BitrixService],
  exports: [BitrixService],
})
export class BitrixModule {}
