import type { LogLevel } from '@nestjs/common'
import type { LoggerOptions as TypeOrmLoggerOptions } from 'typeorm'

export const isProductionEnvironment = (
  nodeEnv?: string,
  devFlag?: string,
): boolean => nodeEnv === 'production' && devFlag !== 'true'

export const getNestLoggerLevels = (
  nodeEnv?: string,
  devFlag?: string,
): LogLevel[] => {
  if (isProductionEnvironment(nodeEnv, devFlag)) {
    return ['error', 'warn', 'log']
  }

  return ['error', 'warn', 'log', 'debug', 'verbose']
}

export const getTypeOrmLoggingOptions = (
  nodeEnv?: string,
  devFlag?: string,
): TypeOrmLoggerOptions => {
  if (isProductionEnvironment(nodeEnv, devFlag)) {
    return ['error', 'warn']
  }

  return ['query', 'error', 'warn', 'schema', 'migration']
}
