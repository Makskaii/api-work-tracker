import { BadRequestException } from '@nestjs/common'
import { isISO8601 } from 'class-validator'
import dayjs from 'dayjs'
import type { CreateReportProjectDto } from './dto/create-project-report-project.dto'

type ProjectDates = Pick<CreateReportProjectDto, 'projectStartDate' | 'contractEndDate'>

/** Validate supplied local metadata before a CRM call or persistence. */
export function assertProjectMetadata(
  changes: Partial<CreateReportProjectDto>,
  current: ProjectDates = {},
): void {
  const purchasedHours = changes.summaryPurchasedHours
  if (purchasedHours != null &&
    (typeof purchasedHours !== 'number' || !Number.isFinite(purchasedHours) || purchasedHours < 0)) {
    throw new BadRequestException('Купленные часы должны быть неотрицательным числом')
  }

  if (changes.projectStartDate === undefined && changes.contractEndDate === undefined) return

  // Omitted fields retain the saved value; null deliberately clears it.
  const startDate = changes.projectStartDate !== undefined ? changes.projectStartDate : current.projectStartDate
  const endDate = changes.contractEndDate !== undefined ? changes.contractEndDate : current.contractEndDate
  for (const date of [startDate, endDate]) {
    if (date != null && (typeof date !== 'string' || !isISO8601(date, { strict: true }) || !dayjs(date).isValid())) {
      throw new BadRequestException('Укажите корректные даты начала и окончания проекта')
    }
  }
  if (startDate && endDate && dayjs(endDate).isBefore(dayjs(startDate), 'day')) {
    throw new BadRequestException('Дата окончания проекта не может быть раньше даты начала')
  }
}
