import { ClientResponseDto } from './dto/client-response.dto'
import { Client } from './entities/client.entity'

export const toClientResponseDto = (client: Client): ClientResponseDto => ({
  id: client.id,
  name: client.name,
  crmClientId: client.crmClientId,
  status: client.status,
  lastLogin: client.lastLogin,
  createdAt: client.createdAt,
  updatedAt: client.updatedAt,
  email: client.email,
})
