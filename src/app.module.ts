import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { ClientsModule } from './clients/clients.module'
import { Client } from './clients/entities/client.entity'
import { DocRecordsModule } from './doc-records/doc-records.module'

<<<<<<< HEAD

import { RedisModule } from './shared/redis/redis.module'

=======
>>>>>>> main

import { RedisModule } from './shared/redis/redis.module'
import { UserSprintsModule } from './user-sprints/user-sprints.module'

@Module({
  imports: [
<<<<<<< HEAD
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
    
=======
    ConfigModule.forRoot({
      isGlobal: true,
    }),
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
        synchronize: false,
        logging: true,
      }),
    }),
>>>>>>> main
    DocRecordsModule,
    RedisModule,
    UserSprintsModule,
    ClientsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
