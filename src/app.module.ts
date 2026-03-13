import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { DocRecordsModule } from './doc-records/doc-records.module'

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
    DocRecordsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
