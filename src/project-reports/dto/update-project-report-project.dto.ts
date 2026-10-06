import { OmitType, PartialType } from '@nestjs/mapped-types'
import { CreateReportProjectDto } from './create-project-report-project.dto'

export class UpdateReportProjectDto extends PartialType(
  OmitType(CreateReportProjectDto, ['creationRequestId', 'newCompanyTitle'] as const),
) {}
