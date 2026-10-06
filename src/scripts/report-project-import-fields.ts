import { ConflictException } from '@nestjs/common'
import { type ReportProject, ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import type { ProjectCompanyLink } from '../project-reports/project-bitrix.service'

export const getReportProjectImportFields = (
  link: ProjectCompanyLink,
  existing?: Pick<ReportProject, 'bitrixProjectId'> | null,
): Partial<ReportProject> => {
  if (existing?.bitrixProjectId && existing.bitrixProjectId !== link.bitrixProjectId) {
    throw new ConflictException('У проекта Work Tracker уже есть другая связь с Битрикс24')
  }
  const fields = {
    bitrixProjectId: link.bitrixProjectId,
    clientCompanyId: link.clientCompanyId,
    clientCompany: link.clientCompany,
  }
  return existing ? fields : { ...fields, title: link.title, projectType: ReportProjectType.Waterfall }
}
