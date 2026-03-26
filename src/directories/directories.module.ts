import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { BitrixModule } from 'src/shared/integrations/bitrix/bitrix.module'
import { DirectoriesService } from './directories.service'
import { DirectoryClient } from './entities/directory-client.entity'
import { DirectoryProject } from './entities/directory-project.entity'
import { DirectoryStatus } from './entities/directory-status.entity'

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DirectoryProject,
      DirectoryClient,
      DirectoryStatus,
    ]),
    BitrixModule,
  ],
  providers: [DirectoriesService],
  exports: [DirectoriesService],
})
export class DirectoriesModule {}
