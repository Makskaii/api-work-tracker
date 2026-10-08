import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { BitrixModule } from '../shared/integrations/bitrix/bitrix.module'
import { RedisModule } from '../shared/redis/redis.module'
import { EmployeeAuthController } from './employee-auth.controller'
import { EmployeeAuthService } from './employee-auth.service'
import { EmployeeAccessGuard } from './employee-access.guard'
import { EmployeeRestController } from './employee-rest.controller'
import { EmployeeRestService } from './employee-rest.service'

@Module({
  imports: [RedisModule, BitrixModule],
  controllers: [EmployeeAuthController, EmployeeRestController],
  providers: [EmployeeAuthService, EmployeeRestService, { provide: APP_GUARD, useClass: EmployeeAccessGuard }],
  exports: [EmployeeAuthService],
})
export class EmployeeAuthModule {}
