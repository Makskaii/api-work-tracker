import { Transform } from 'class-transformer'
import { IsEnum, IsOptional, IsString } from 'class-validator'
import { ClientStatus } from '../entities/client.entity'

const emptyToUndefined = ({ value }: { value?: string }) => {
  if (!value || value === 'all') {
    return undefined
  }

  return value
}

export class GetClientsQueryDto {
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsEnum(ClientStatus)
  status?: ClientStatus

  @Transform(({ value }: { value?: string }) => value?.trim() || undefined)
  @IsOptional()
  @IsString()
  search?: string
}
