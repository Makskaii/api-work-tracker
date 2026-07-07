import { ClientResponseDto } from './dto/client-response.dto'
import { ClientPurchasedHoursEventResponseDto } from './dto/client-purchased-hours-event-response.dto'
import { ClientPurchasedHoursEvent } from './entities/client-purchased-hours-event.entity'
import { Client } from './entities/client.entity'

export const toClientResponseDto = (client: Client): ClientResponseDto => ({
  id: client.id,
  name: client.name,
  crmClientId: client.crmClientId,
  status: client.status,
  lastLogin: client.lastLogin,
  purchasedHours: toNullableNumber(client.purchasedHours),
  hasPurchasedHours:
    client.purchasedHours !== null && client.purchasedHours !== undefined,
  createdAt: client.createdAt,
  updatedAt: client.updatedAt,
  email: client.email,
})

export const toClientPurchasedHoursEventResponseDto = (
  event: ClientPurchasedHoursEvent,
): ClientPurchasedHoursEventResponseDto => ({
  id: event.id,
  clientId: event.clientId,
  type: event.type,
  hours: Number(event.hours),
  amount: toNullableNumber(event.amount),
  balanceAfter: Number(event.balanceAfter),
  date: event.date,
  comment: event.comment,
  createdAt: event.createdAt,
})

const toNullableNumber = (
  value: number | string | null | undefined,
): number | null => {
  if (value === null || value === undefined) {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}
