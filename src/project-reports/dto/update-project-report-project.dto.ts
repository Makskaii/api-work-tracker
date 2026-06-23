import { PartialType } from '@nestjs/mapped-types'
import { CreateProjectReportProjectDto } from './create-project-report-project.dto'

export class UpdateProjectReportProjectDto extends PartialType(
  CreateProjectReportProjectDto,
) {}
