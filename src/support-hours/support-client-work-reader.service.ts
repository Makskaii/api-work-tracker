import { BadGatewayException, Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { DailyReportCodes, EntityTypeIds, reportSelectFields } from '../constants/const'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import type { SupportPackageReportRow } from '../shared/pdf/support-package-report.template'

dayjs.extend(utc)
dayjs.extend(timezone)

export type SupportClientWork = { taskId: string; row: SupportPackageReportRow }
type BitrixWork = Record<string, unknown>
const positiveId = (value: unknown): string | null =>
  (typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value)) &&
  Number.isSafeInteger(Number(value)) && Number(value) > 0 ? String(Number(value)) : null

/** Read full task history for presentation only; never import or allocate package hours. */
@Injectable()
export class SupportClientWorkReaderService {
  constructor(private readonly bitrix: BitrixService) {}

  async read(taskIds: readonly string[], now: Date): Promise<SupportClientWork[]> {
    const ids = [...new Set(taskIds.map(positiveId).filter((id): id is string => id !== null))]
    const allowed = new Set(ids)
    const works = new Map<string, SupportClientWork>()
    const today = dayjs(now).tz('Europe/Moscow').format('YYYY-MM-DD')
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50)
      // Both relation fields exist in historical cards. Neither the TP flag nor a
      // package allocation decides which cabinet task's descriptions are shown.
      const results = await Promise.all([DailyReportCodes.parentId, DailyReportCodes.taskId].map((field) =>
        this.bitrix.listAllItems<BitrixWork>({
          entityTypeId: EntityTypeIds.reports, filter: { [`@${field}`]: batch }, select: [...reportSelectFields],
        })))
      for (const report of results.flat()) {
        const id = positiveId(report.id)
        const parentId = positiveId(report[DailyReportCodes.parentId])
        const customId = positiveId(report[DailyReportCodes.taskId])
        if (parentId && customId && parentId !== customId && (allowed.has(parentId) || allowed.has(customId))) {
          throw new BadGatewayException('У отчёта указаны разные задачи. Исправьте связь в Битрикс24 перед выгрузкой')
        }
        const taskId = parentId ?? customId
        if (!id || !taskId || !allowed.has(taskId)) continue
        const rawDate = report.begindate || report.createdTime
        if (typeof rawDate !== 'string' || !dayjs(rawDate).isValid()) continue
        const date = dayjs(rawDate).tz('Europe/Moscow').format('YYYY-MM-DD')
        if (date > today) continue
        const rawHours = report[DailyReportCodes.timeSpent]
        const hours = typeof rawHours === 'number' ? rawHours : typeof rawHours === 'string'
          ? Number(rawHours.trim().replace(',', '.')) : 0
        if (!Number.isFinite(hours) || hours < 0) throw new BadGatewayException('В отчёте некорректно указаны часы. Исправьте его в Битрикс24')
        const description = typeof report[DailyReportCodes.title] === 'string' ? report[DailyReportCodes.title].trim() : ''
        works.set(id, { taskId, row: {
          id, date, hours: Math.round(hours * 100) / 100,
          description: description || (typeof report.title === 'string' && report.title.trim()) || `Отчёт №${id}`,
        } })
      }
    }
    return [...works.values()].sort((a, b) => a.row.date.localeCompare(b.row.date) || a.row.id.localeCompare(b.row.id, undefined, { numeric: true }))
  }
}
