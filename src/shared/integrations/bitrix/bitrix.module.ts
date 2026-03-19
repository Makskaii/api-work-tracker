import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { BitrixService } from './bitrix.service'

@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        baseURL: configService.get<string>('API_URL'),
        timeout: 15000,
      }),
    }),
  ],
  providers: [BitrixService],
  exports: [BitrixService],
})
export class BitrixModule {}
