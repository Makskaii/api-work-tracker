import { ClientStatus } from '../entities/client.entity'

export class ClientResponseDto {
  id: number
  name: string
  email: string
  crmClientId: number
  status: ClientStatus
  lastLogin: Date | null
  createdAt: Date
  updatedAt: Date
}
