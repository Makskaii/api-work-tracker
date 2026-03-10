import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'

@Injectable()
export class AppService {
  constructor(private dataSource: DataSource) {}

  async checkDb() {
    await this.dataSource.query('SELECT 1')
    return { db: 'ok' }
  }
}
