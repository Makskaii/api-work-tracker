import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { DataSource, Repository } from 'typeorm'
import { AppModule } from '../app.module'
import { EntityTypeIds, FinancialProjectType, ProjectCodes } from '../constants/const'
import { ReportProject } from '../project-reports/entities/project-report-project.entity'
import { ProjectBitrixService } from '../project-reports/project-bitrix.service'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { getReportProjectImportFields } from './report-project-import-fields'

type BitrixProject = {
  id?: string | number
  title?: string | null
  [ProjectCodes.financialProjectType]?: string | string[] | number | number[] | null
}

const hasFinancialType = (project: BitrixProject, type: string) => {
  const value = project[ProjectCodes.financialProjectType]
  return Array.isArray(value) ? value.map(String).includes(type) : String(value ?? '') === type
}

const findExistingProject = async (
  repository: Repository<ReportProject>,
  bitrixProjectId: string,
  title: string,
) => {
  const existingByBitrixId = await repository.findOne({ where: { bitrixProjectId } })
  return existingByBitrixId ?? repository.findOne({ where: { title } })
}

const importProjects = async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  try {
    const bitrixService = app.get(BitrixService)
    const projectBitrixService = app.get(ProjectBitrixService)
    const reportProjectRepository = app.get(DataSource).getRepository(ReportProject)
    const bitrixProjects = await bitrixService.listAllItems<BitrixProject>({
      entityTypeId: EntityTypeIds.projects,
      select: ['id', 'title', ProjectCodes.financialProjectType],
      filter: {},
    })
    const waterfallProjects = bitrixProjects.filter(
      (project) => hasFinancialType(project, FinancialProjectType.Waterfall) && String(project.title ?? '').trim(),
    )
    let created = 0
    let updated = 0

    for (const bitrixProject of waterfallProjects) {
      const bitrixProjectId = projectBitrixService.positiveId(bitrixProject.id, 'проекта Битрикс24')
      await projectBitrixService.withProjectLock(bitrixProjectId, async () => {
        const link = await projectBitrixService.resolveProjectLink(bitrixProjectId)
        const existingProject = await findExistingProject(reportProjectRepository, bitrixProjectId, link.title)
        const fields = getReportProjectImportFields(link, existingProject)
        if (existingProject) {
          await reportProjectRepository.save({ ...existingProject, ...fields })
          updated += 1
        } else {
          await reportProjectRepository.save(reportProjectRepository.create(fields))
          created += 1
        }
      })
    }

    console.log(['Report projects import finished', 'bitrixProjects=' + bitrixProjects.length, 'waterfallProjects=' + waterfallProjects.length, 'created=' + created, 'updated=' + updated].join(' '))
  } finally {
    await app.close()
  }
}

importProjects().catch((error) => {
  console.error('Report projects import failed', error)
  process.exitCode = 1
})
