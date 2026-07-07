import { ClientPurchasedHoursEventType } from '../entities/client-purchased-hours-event.entity'

export class ClientPurchasedHoursEventResponseDto {
  id: number
  clientId: number
  type: ClientPurchasedHoursEventType
  hours: number
  amount: number | null
  balanceAfter: number
  date: string | null
  comment: string | null
  createdAt: Date
}
