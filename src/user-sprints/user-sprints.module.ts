import { Module } from '@nestjs/common'
import { BitrixModule } from 'src/shared/integrations/bitrix/bitrix.module'
import { RedisModule } from 'src/shared/redis/redis.module'
import { UserSprintsController } from './user-sprints.controller'
import { UserSprintsService } from './user-sprints.service'

@Module({
  imports: [BitrixModule, RedisModule],
  controllers: [UserSprintsController],
  providers: [UserSprintsService],
})
export class UserSprintsModule {}
