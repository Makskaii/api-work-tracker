import { ConflictException } from '@nestjs/common'
import type { DataSource, EntityManager } from 'typeorm'

export function bitrixProjectLockName(bitrixProjectId: string): string {
  return `work-tracker:bitrix-project:${bitrixProjectId}`
}

/** Acquire every shared project lock before opening a fresh database snapshot. */
export async function withBitrixProjectLocks<T>(
  dataSource: DataSource,
  bitrixProjectIds: readonly string[],
  operation: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const runner = dataSource.createQueryRunner()
  const locks: string[] = []
  await runner.connect()
  try {
    const ids = [...new Set(bitrixProjectIds)].sort((left, right) => Number(left) - Number(right))
    for (const id of ids) {
      const name = bitrixProjectLockName(id)
      const result: Array<{ acquired: unknown }> = await runner.query('SELECT GET_LOCK(?, 5) AS acquired', [name])
      if (Number(result[0]?.acquired) !== 1) {
        throw new ConflictException('Проект уже сохраняется. Повторите обновление через несколько секунд')
      }
      locks.push(name)
    }
    await runner.startTransaction('READ COMMITTED')
    const result = await operation(runner.manager)
    await runner.commitTransaction()
    return result
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction()
    throw error
  } finally {
    try {
      for (const name of locks.reverse()) {
        await runner.query('SELECT RELEASE_LOCK(?) AS released', [name])
      }
    } finally {
      await runner.release()
    }
  }
}
