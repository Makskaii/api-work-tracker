import { ClientResponseDto } from './dto/client-response.dto'
import { Client } from './entities/client.entity'

export const toClientResponseDto = (client: Client): ClientResponseDto => ({
  id: client.id,
  name: client.name,
  crmClientId: client.crmClientId,
  createdAt: client.createdAt,
  updatedAt: client.updatedAt,
  email: client.email,
})
