import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { DataSource, Repository } from 'typeorm'
import { AppModule } from '../app.module'
import {
  EntityTypeIds,
  FinancialProjectType,
  ProjectCodes,
  ProjectGanttCodes,
} from '../constants/const'
import {
  ReportProject,
  ReportProjectType,
} from '../project-reports/entities/project-report-project.entity'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'

type BitrixProject = {
  id?: string | number
  title?: string | null
  assignedById?: string | number | null
  [ProjectCodes.analytic]?: string | number | null
  [ProjectCodes.company]?: string | number | null
  [ProjectCodes.devs]?: string | number | null
  [ProjectCodes.financialProjectType]?: string | string[] | number | number[] | null
  [ProjectCodes.parentDeal]?: string | number | null
  [ProjectCodes.projectAmount]?: string | number | null
  [ProjectCodes.qa]?: string | number | null
  [ProjectGanttCodes.ganttCloseDate]?: string | null
  [ProjectGanttCodes.ganttDevFactEnd]?: string | null
  [ProjectGanttCodes.ganttDevFactStart]?: string | null
  [ProjectGanttCodes.ganttDevPlanEnd]?: string | null
  [ProjectGanttCodes.ganttDevPlanStart]?: string | null
  [ProjectGanttCodes.ganttDevWeeks]?: string | number | null
  [ProjectGanttCodes.ganttEducationFactEnd]?: string | null
  [ProjectGanttCodes.ganttEducationFactStart]?: string | null
  [ProjectGanttCodes.ganttEducationPlanEnd]?: string | null
  [ProjectGanttCodes.ganttEducationPlanStart]?: string | null
  [ProjectGanttCodes.ganttEducationWeeks]?: string | number | null
  [ProjectGanttCodes.ganttTzFactEnd]?: string | null
  [ProjectGanttCodes.ganttTzPlanEnd]?: string | null
  [ProjectGanttCodes.ganttTzSignDate]?: string | null
  [ProjectGanttCodes.ganttTzStart]?: string | null
  [ProjectGanttCodes.ganttTzWeeks]?: string | number | null
}

type BitrixCompany = {
  id?: string | number
  title?: string | null
}

const projectSelectFields = [
  'id',
  'title',
  'assignedById',
  ProjectCodes.analytic,
  ProjectCodes.company,
  ProjectCodes.devs,
  ProjectCodes.financialProjectType,
  ProjectCodes.parentDeal,
  ProjectCodes.projectAmount,
  ProjectCodes.qa,
  ...Object.values(ProjectGanttCodes),
] as const

const toText = (value: unknown) => {
  const text = String(value ?? '').trim()

  return text || null
}

const toNumberOrNull = (value: unknown) => {
  const normalized = String(value ?? '')
    .split('|')[0]
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '')

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)

  return Number.isFinite(parsed) ? parsed : null
}

const toDateOrNull = (value: unknown) => {
  const text = toText(value)

  return text ? text.slice(0, 10) : null
}

const hasFinancialType = (project: BitrixProject, type: string) => {
  const value = project[ProjectCodes.financialProjectType]

  if (Array.isArray(value)) {
    return value.map(String).includes(type)
  }

  return String(value ?? '') === type
}

const getUniqueValues = (values: Array<string | number | null | undefined>) =>
  Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean)),
  )

const getUserIds = (projects: BitrixProject[]) =>
  getUniqueValues(
    projects.flatMap((project) => [
      project.assignedById,
      project[ProjectCodes.analytic],
      project[ProjectCodes.qa],
    ]),
  )
    .map(Number)
    .filter((userId) => Number.isFinite(userId) && userId > 0)

const loadCompanyTitleById = async (
  bitrixService: BitrixService,
  companyIds: string[],
) => {
  if (!companyIds.length) {
    return new Map<string, string>()
  }

  const companies = await bitrixService.listAllItems<BitrixCompany>({
    entityTypeId: EntityTypeIds.companies,
    select: ['id', 'title'],
    filter: { '@id': companyIds },
  })

  return new Map(
    companies
      .map((company): [string, string] => [
        String(company.id ?? '').trim(),
        String(company.title ?? '').trim(),
      ])
      .filter(([id, title]) => id && title),
  )
}

const findExistingProject = async (
  repository: Repository<ReportProject>,
  bitrixProjectId: string,
  title: string,
) => {
  const existingByBitrixId = bitrixProjectId
    ? await repository.findOne({ where: { bitrixProjectId } })
    : null

  return existingByBitrixId ?? repository.findOne({ where: { title } })
}

const mapProjectFields = (
  bitrixProject: BitrixProject,
  companyTitleById: Map<string, string>,
  userTitleById: Map<string, string>,
): Partial<ReportProject> => {
  const companyId = String(bitrixProject[ProjectCodes.company] ?? '').trim()
  const bitrixProjectId = String(bitrixProject.id ?? '').trim()
  const getUserTitle = (value: unknown) => {
    const userId = String(value ?? '').trim()

    return userTitleById.get(userId) ?? toText(value)
  }

  return {
    analyst: getUserTitle(bitrixProject[ProjectCodes.analytic]),
    analystId: toText(bitrixProject[ProjectCodes.analytic]),
    bitrixProjectId: bitrixProjectId || null,
    clientCompany: companyTitleById.get(companyId) ?? null,
    closeDate: toDateOrNull(bitrixProject[ProjectGanttCodes.ganttCloseDate]),
    deal: toText(bitrixProject[ProjectCodes.parentDeal]),
    developmentFactEndDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttDevFactEnd],
    ),
    developmentFactStartDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttDevFactStart],
    ),
    developmentPlanEndDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttDevPlanEnd],
    ),
    developmentPlanStartDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttDevPlanStart],
    ),
    developmentTeam: toText(bitrixProject[ProjectCodes.devs]),
    developmentTeamIds: toText(bitrixProject[ProjectCodes.devs]),
    developmentWeeks: toNumberOrNull(
      bitrixProject[ProjectGanttCodes.ganttDevWeeks],
    ),
    educationFactEndDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttEducationFactEnd],
    ),
    educationFactStartDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttEducationFactStart],
    ),
    educationPlanEndDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttEducationPlanEnd],
    ),
    educationPlanStartDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttEducationPlanStart],
    ),
    educationWeeks: toNumberOrNull(
      bitrixProject[ProjectGanttCodes.ganttEducationWeeks],
    ),
    projectAmount: toNumberOrNull(bitrixProject[ProjectCodes.projectAmount]),
    projectType: ReportProjectType.Waterfall,
    qa: getUserTitle(bitrixProject[ProjectCodes.qa]),
    qaId: toText(bitrixProject[ProjectCodes.qa]),
    responsible: getUserTitle(bitrixProject.assignedById),
    responsibleId: toText(bitrixProject.assignedById),
    summaryFactCompletionDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttCloseDate],
    ),
    summaryPlanCompletionDate: toDateOrNull(
      bitrixProject[ProjectGanttCodes.ganttEducationPlanEnd],
    ),
    title: String(bitrixProject.title ?? '').trim(),
    tzFactEndDate: toDateOrNull(bitrixProject[ProjectGanttCodes.ganttTzFactEnd]),
    tzPlanEndDate: toDateOrNull(bitrixProject[ProjectGanttCodes.ganttTzPlanEnd]),
    tzSignDate: toDateOrNull(bitrixProject[ProjectGanttCodes.ganttTzSignDate]),
    tzStartDate: toDateOrNull(bitrixProject[ProjectGanttCodes.ganttTzStart]),
    tzWeeks: toNumberOrNull(bitrixProject[ProjectGanttCodes.ganttTzWeeks]),
  }
}

const importProjects = async () => {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  try {
    const bitrixService = app.get(BitrixService)
    const dataSource = app.get(DataSource)
    const reportProjectRepository = dataSource.getRepository(ReportProject)

    const bitrixProjects = await bitrixService.listAllItems<BitrixProject>({
      entityTypeId: EntityTypeIds.projects,
      select: projectSelectFields,
      filter: {},
    })
    const waterfallProjects = bitrixProjects.filter(
      (project) =>
        hasFinancialType(project, FinancialProjectType.Waterfall) &&
        String(project.title ?? '').trim(),
    )
    const companyIds = getUniqueValues(
      waterfallProjects.map((project) => project[ProjectCodes.company]),
    )
    const companyTitleById = await loadCompanyTitleById(bitrixService, companyIds)
    const users = await bitrixService.getUsersByIds(getUserIds(waterfallProjects))
    const userTitleById = new Map(users.map((user) => [user.id, user.title]))
    let created = 0
    let updated = 0
    let skipped = 0

    for (const bitrixProject of waterfallProjects) {
      const title = String(bitrixProject.title ?? '').trim()
      const bitrixProjectId = String(bitrixProject.id ?? '').trim()

      if (!title) {
        skipped += 1
        continue
      }

      const fields = mapProjectFields(
        bitrixProject,
        companyTitleById,
        userTitleById,
      )
      const existingProject = await findExistingProject(
        reportProjectRepository,
        bitrixProjectId,
        title,
      )

      if (existingProject) {
        await reportProjectRepository.save({
          ...existingProject,
          ...fields,
          title,
        })
        updated += 1
        continue
      }

      await reportProjectRepository.save(
        reportProjectRepository.create({
          ...fields,
          title,
        }),
      )
      created += 1
    }

    console.log(
      [
        'Report projects import finished',
        `bitrixProjects=${bitrixProjects.length}`,
        `waterfallProjects=${waterfallProjects.length}`,
        `created=${created}`,
        `updated=${updated}`,
        `skipped=${skipped}`,
      ].join(' '),
    )
  } finally {
    await app.close()
  }
}

importProjects().catch((error) => {
  console.error('Report projects import failed', error)
  process.exitCode = 1
})
