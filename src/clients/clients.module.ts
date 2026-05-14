import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AuthModule } from 'src/auth/auth.module'
import { ClientJwtGuard } from 'src/auth/client-jwt.guard'
import { BitrixModule } from 'src/shared/integrations/bitrix/bitrix.module'
import { ClientsController } from './clients.controller'
import { ClientsService } from './clients.service'
import { Client } from './entities/client.entity'

@Module({
  imports: [TypeOrmModule.forFeature([Client]), BitrixModule, AuthModule],
  controllers: [ClientsController],
  providers: [ClientsService, ClientJwtGuard],
})
export class ClientsModule {}
