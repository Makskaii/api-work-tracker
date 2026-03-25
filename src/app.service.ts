import { Injectable } from '@nestjs/common'
import { DataSource } from 'typeorm'
import { RedisService } from './shared/redis/redis.service'

@Injectable()
export class AppService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  async checkHealth() {
    let db: 'up' | 'down' = 'down'
    let redis: 'up' | 'down' = 'down'

    try {
      await this.dataSource.query('SELECT 1')
      db = 'up'
    } catch {
      db = 'down'
    }

    try {
      await this.redisService.get('healthcheck:test')
      redis = 'up'
    } catch {
      redis = 'down'
    }

    const status = db === 'up' && redis === 'up' ? 'ok' : 'degraded'

    return {
      status,
      db,
      redis,
      timestamp: new Date().toISOString(),
    }
  }
}
