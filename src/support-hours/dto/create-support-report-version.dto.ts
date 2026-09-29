import { IsUUID } from 'class-validator'

export class CreateSupportReportVersionDto {
  @IsUUID('4')
  requestId!: string
}
