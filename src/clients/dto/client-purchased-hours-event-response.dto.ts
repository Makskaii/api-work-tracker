import { ClientPurchasedHoursEventType } from '../entities/client-purchased-hours-event.entity'

export class ClientPurchasedHoursEventResponseDto {
  id: number
  clientId: number
  type: ClientPurchasedHoursEventType
  hours: number
  balanceAfter: number
  comment: string | null
  createdAt: Date
}
