import { BadRequestException } from '@nestjs/common'
import { IsDateString, IsString, Matches, ValidateIf } from 'class-validator'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'

dayjs.extend(utc)
dayjs.extend(timezone)

export type SupportPackageReportScope = {
  dateFrom: string
  dateTo: string
}

export class DownloadSupportPackageReportDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string
}

const isCalendarDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && dayjs.utc(value).isValid()
  && dayjs.utc(value).format('YYYY-MM-DD') === value

/** Undefined scope means the complete client report; date bounds are inclusive. */
export function validateSupportPackageReportScope(input?: unknown, now = new Date()): SupportPackageReportScope | undefined {
  if (input === undefined) return undefined
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new BadRequestException('Параметры отчёта должны быть объектом')
  }
  const fields = input as Record<string, unknown>
  if (Object.keys(fields).some((key) => key !== 'dateFrom' && key !== 'dateTo')) {
    throw new BadRequestException('Неизвестный параметр отчёта')
  }
  if (fields.dateFrom === undefined && fields.dateTo === undefined) return undefined
  if (fields.dateFrom === undefined || fields.dateTo === undefined) {
    throw new BadRequestException('Укажите обе даты периода отчёта')
  }
  if (!isCalendarDate(fields.dateFrom) || !isCalendarDate(fields.dateTo)) {
    throw new BadRequestException('Укажите существующие даты в формате ГГГГ-ММ-ДД')
  }
  if (fields.dateFrom > fields.dateTo) {
    throw new BadRequestException('Начало периода не может быть позже окончания')
  }
  if (fields.dateTo > dayjs(now).tz('Europe/Moscow').format('YYYY-MM-DD')) {
    throw new BadRequestException('Окончание периода не может быть позже сегодняшнего дня')
  }
  return { dateFrom: fields.dateFrom, dateTo: fields.dateTo }
}
