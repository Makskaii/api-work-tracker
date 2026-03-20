import { Module } from '@nestjs/common'
import { RedisModule } from 'src/redis/redis.module'
import { BitrixModule } from 'src/shared/integrations/bitrix/bitrix.module'
import { UserSprintsController } from './user-sprints.controller'
import { UserSprintsService } from './user-sprints.service'

@Module({
  imports: [BitrixModule, RedisModule],
  controllers: [UserSprintsController],
  providers: [UserSprintsService],
})
export class UserSprintsModule {}
