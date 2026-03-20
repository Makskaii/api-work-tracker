import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { DocRecordsModule } from './doc-records/doc-records.module'
import { RedisModule } from './redis/redis.module'
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
    ScheduleModule.forRoot(),
    RedisModule,
    DocRecordsModule,
    UserSprintsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
