import { Module } from '@nestjs/common';
import { UserSprintsService } from './user-sprints.service';
import { UserSprintsController } from './user-sprints.controller';
import { BitrixModule } from 'src/shared/integrations/bitrix/bitrix.module';

@Module({
  imports: [BitrixModule],
  controllers: [UserSprintsController],
  providers: [UserSprintsService],
})
export class UserSprintsModule {}
