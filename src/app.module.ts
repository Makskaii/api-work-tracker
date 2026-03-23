import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { DocRecordsModule } from './doc-records/doc-records.module'
import { RedisModule } from './shared/redis/redis.module'
import { UserSprintsModule } from './user-sprints/user-sprints.module'

@Module({
  imports: [
    // TypeOrmModule.forRoot({
    //   type: 'mysql',
    //   host: 'localhost',
    //   port: 3306,
    //   username: 'app_user',
    //   password: 'app_pass',
    //   database: 'analytics_db',
    //   autoLoadEntities: true,
    //   synchronize: false,
    //   logging: true,
    // }),
    // EmployeeModule,
    RedisModule,
    DocRecordsModule,
    UserSprintsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
