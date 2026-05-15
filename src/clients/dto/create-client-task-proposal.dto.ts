import { Transform } from 'class-transformer'
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator'

export type ClientTaskProposalFile = {
  originalname: string
  buffer: Buffer
  size: number
}

export class CreateClientTaskProposalDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  title: string

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  description: string

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  project: number
}

export class ClientTaskProposalResponseDto {
  id: number
  title: string
  description: string
  assignedById: number
  stageId: string
  timelineCommentId: number | null
  attachedFilesCount: number
}
