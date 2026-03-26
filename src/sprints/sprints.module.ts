import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BitrixModule } from 'src/shared/integrations/bitrix/bitrix.module'
import { SprintTaskSnapshot } from './entities/sprint-task-snapshot.entity'
import { SprintsController } from './sprints.controller'
import { SprintsService } from './sprints.service'

@Module({
  imports: [TypeOrmModule.forFeature([SprintTaskSnapshot]), BitrixModule],
  controllers: [SprintsController],
  providers: [SprintsService],
  exports: [SprintsService],
})
export class SprintsModule {}
