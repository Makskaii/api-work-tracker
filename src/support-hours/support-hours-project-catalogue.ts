import { BadGatewayException } from '@nestjs/common'
import type { DataSource, Repository } from 'typeorm'
import { EntityTypeIds, FinancialProjectType, ProjectCodes } from '../constants/const'
import { ReportProject, ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import type { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { withBitrixProjectLocks } from '../project-reports/project-bitrix-lock'

const PROJECT_SELECT = ['id', 'title', ProjectCodes.financialProjectType]
const RECHECK_BATCH_SIZE = 50

type SourceProject = { bitrixProjectId: string; title: string | null; projectType: ReportProjectType }

function sourceId(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'string' && !/^\d+$/.test(value)) ||
    !Number.isSafeInteger(Number(value)) || Number(value) <= 0) {
    throw new BadGatewayException('Битрикс вернул некорректный идентификатор проекта')
  }
  return String(Number(value))
}

function readProject(value: unknown): SourceProject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadGatewayException('Битрикс вернул некорректный проект')
  }
  const item = value as Record<string, unknown>
  if (!Object.hasOwn(item, ProjectCodes.financialProjectType) ||
    (item.title != null && typeof item.title !== 'string')) {
    throw new BadGatewayException('Не удалось проверить тип проекта в Битрикс24')
  }
  const rawType = item[ProjectCodes.financialProjectType]
  const values = Array.isArray(rawType) ? rawType : rawType === null ? [] : [rawType]
  if (values.some((type) => typeof type !== 'string' && (typeof type !== 'number' || !Number.isSafeInteger(type)))) {
    throw new BadGatewayException('Битрикс вернул некорректный тип проекта')
  }
  const types = values.map((type) => String(type).trim())
  const projectType = types.includes(FinancialProjectType.Support) ? ReportProjectType.Support
    : types.includes(FinancialProjectType.Waterfall) ? ReportProjectType.Waterfall : ReportProjectType.None
  return { bitrixProjectId: sourceId(item.id), title: typeof item.title === 'string' ? item.title.trim() || null : null, projectType }
}

/** Reconcile catalogue metadata only. Never remove projects or touch their accounting/history. */
export async function synchronizeSupportProjectCatalogue(
  projectsRepository: Repository<ReportProject>,
  dataSource: DataSource,
  bitrix: BitrixService,
): Promise<{ created: number; updated: number }> {
  const storedSupport = await projectsRepository.find({ where: { projectType: ReportProjectType.Support } })
  const discovered = await bitrix.listAllItems<unknown>({
    entityTypeId: EntityTypeIds.projects,
    filter: { [ProjectCodes.financialProjectType]: FinancialProjectType.Support },
    select: PROJECT_SELECT,
  })
  const observed = new Map<string, SourceProject>()
  for (const value of discovered) {
    const project = readProject(value)
    if (observed.has(project.bitrixProjectId) || project.projectType !== ReportProjectType.Support) {
      throw new BadGatewayException('Битрикс вернул некорректный список проектов техподдержки')
    }
    observed.set(project.bitrixProjectId, project)
  }

  // Absence from a type-filtered list does not establish the new type. Read those IDs
  // without the support filter, including projects which have no reports or packages.
  // Locally created projects without a Bitrix link are outside this synchronization.
  const missingIds = [...new Set(storedSupport
    .filter((project) => project.bitrixProjectId != null && project.bitrixProjectId !== '')
    .map((project) => sourceId(project.bitrixProjectId))
    .filter((id) => !observed.has(id)))]
  for (let offset = 0; offset < missingIds.length; offset += RECHECK_BATCH_SIZE) {
    const ids = missingIds.slice(offset, offset + RECHECK_BATCH_SIZE)
    const current = await bitrix.listAllItems<unknown>({
      entityTypeId: EntityTypeIds.projects, filter: { '@id': ids }, select: PROJECT_SELECT,
    })
    const seen = new Set<string>()
    for (const value of current) {
      const project = readProject(value)
      if (!ids.includes(project.bitrixProjectId) || seen.has(project.bitrixProjectId)) {
        throw new BadGatewayException('Битрикс вернул некорректный список сверки проектов')
      }
      seen.add(project.bitrixProjectId)
      observed.set(project.bitrixProjectId, project)
    }
    if (seen.size !== ids.length) {
      // A deleted/inaccessible project is not evidence of Waterfall. Preserve all rows
      // and report an incomplete refresh instead of silently reclassifying them.
      throw new BadGatewayException('Не удалось проверить все сохранённые проекты в Битрикс24')
    }
  }

  // Every external page and required field is validated before the first write.
  if (!observed.size) return { created: 0, updated: 0 }
  return await withBitrixProjectLocks(dataSource, [...observed.keys()], async (manager) => {
    const repository = manager.getRepository(ReportProject)
    let created = 0
    let updated = 0
    for (const source of observed.values()) {
      const matches = await repository.find({ where: { bitrixProjectId: source.bitrixProjectId } })
      if (!matches.length) {
        if (source.projectType !== ReportProjectType.Support) continue
        await repository.save(repository.create({
          bitrixProjectId: source.bitrixProjectId,
          title: source.title || `Проект ${source.bitrixProjectId}`,
          projectType: source.projectType,
        }))
        created += 1
        continue
      }
      // Preserve every existing local ID, even when older imports produced multiple
      // linked rows. Partial updates cannot overwrite unrelated planning fields.
      for (const project of matches) {
        const title = source.title || project.title || `Проект ${source.bitrixProjectId}`
        if (project.title === title && project.projectType === source.projectType) continue
        await repository.update({ id: project.id }, { title, projectType: source.projectType })
        updated += 1
      }
    }
    return { created, updated }
  })
}
