import { ClientStatus } from '../entities/client.entity'

export class ClientResponseDto {
  id: number
  name: string
  email: string
  crmClientId: number
  status: ClientStatus
  lastLogin: Date | null
  purchasedHours: number | null
  hasPurchasedHours: boolean
  createdAt: Date
  updatedAt: Date
}
