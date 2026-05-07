import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AuthModule } from './auth/auth.module'
import { ClientsModule } from './clients/clients.module'
import { DocRecordsModule } from './doc-records/doc-records.module'
import { EmployeeModule } from './employee/employee.module'
import { RedisModule } from './shared/redis/redis.module'
import { SprintsModule } from './sprints/sprints.module'
import { UserSprintsModule } from './user-sprints/user-sprints.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get<string>('DB_HOST'),
        port: Number(configService.get<string>('DB_PORT', '3306')),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        autoLoadEntities: true,
        synchronize: configService.get<string>('DEV') === 'true',
        logging: true,
      }),
    }),
    DocRecordsModule,
    RedisModule,
    UserSprintsModule,
    ClientsModule,
    AuthModule,
    SprintsModule,
    EmployeeModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
