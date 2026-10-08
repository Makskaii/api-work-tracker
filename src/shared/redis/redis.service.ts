import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common'
import { createClient } from 'redis'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)

  private readonly client = createClient({
    url: process.env.REDIS_URL,
    RESP: 3,
    clientSideCache: {
      ttl: 0,
      maxEntries: 0,
      evictPolicy: 'LRU',
    },
  })

  constructor() {
    this.client.on('error', (error) => {
      this.logger.error(`Redis error: ${error.message}`, error.stack)
    })
  }

  async onModuleInit() {
    try {
      await this.client.connect()
    } catch {
      throw new ServiceUnavailableException('Не удалось подключиться к Redis')
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.close()
    } catch {
      throw new InternalServerErrorException(
        'Не удалось корректно закрыть соединение с Redis',
      )
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key)
    } catch {
      throw new ServiceUnavailableException(
        `Не удалось получить значение из Redis по ключу ${key}`,
      )
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, {
          EX: ttlSeconds,
        })
        return
      }

      await this.client.set(key, value)
    } catch {
      throw new ServiceUnavailableException(
        `Не удалось записать значение в Redis по ключу ${key}`,
      )
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    const value = await this.get(key)

    if (!value) {
      return null
    }

    try {
      return JSON.parse(value) as T
    } catch {
      throw new InternalServerErrorException(
        `Не удалось распарсить JSON из Redis по ключу ${key}`,
      )
    }
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds)
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key)
    } catch {
      throw new ServiceUnavailableException(
        `Не удалось удалить ключ ${key} из Redis`,
      )
    }
  }

  /** Consume single-use login state without a race between concurrent callbacks. */
  async getDel(key: string): Promise<string | null> {
    try {
      return await this.client.getDel(key)
    } catch {
      throw new ServiceUnavailableException('Не удалось проверить одноразовое состояние входа')
    }
  }

  async acquireLock(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    try {
      return await this.client.set(key, owner, { EX: ttlSeconds, NX: true }) === 'OK'
    } catch {
      throw new ServiceUnavailableException('Не удалось заблокировать обновление сессии')
    }
  }

  async releaseLock(key: string, owner: string): Promise<void> {
    try {
      await this.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", {
        keys: [key], arguments: [owner],
      })
    } catch {
      throw new ServiceUnavailableException('Не удалось завершить обновление сессии')
    }
  }

  /** Never revive a session which was logged out while an upstream request ran. */
  async compareAndSet(key: string, expected: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      return Number(await this.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end", {
        keys: [key], arguments: [expected, value, String(ttlSeconds)],
      })) === 1
    } catch {
      throw new ServiceUnavailableException('Не удалось сохранить обновлённую сессию')
    }
  }

  async flushDb(): Promise<void> {
    try {
      await this.client.flushDb()
    } catch {
      throw new ServiceUnavailableException('Не удалось очистить Redis')
    }
  }
}
