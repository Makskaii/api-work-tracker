import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { DataSource, Repository } from 'typeorm'
import { AppModule } from '../app.module'
import { ReportProject } from '../project-reports/entities/project-report-project.entity'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { UserInfo } from '../types/bitrix'

type MatchResult =
  | { status: 'empty'; ids: string[] }
  | { status: 'matched'; ids: string[] }
  | { status: 'not_found'; ids: string[]; values: string[] }
  | { status: 'ambiguous'; ids: string[]; values: string[] }

type UserIndex = {
  byId: Map<string, UserInfo>
  byName: Map<string, UserInfo[]>
  users: UserInfo[]
}

const userFields = [
  {
    idKey: 'responsibleId',
    label: 'responsible',
    nameKey: 'responsible',
    multiple: false,
  },
  {
    idKey: 'salesManagerId',
    label: 'salesManager',
    nameKey: 'salesManager',
    multiple: false,
  },
  {
    idKey: 'analystId',
    label: 'analyst',
    nameKey: 'analyst',
    multiple: false,
  },
  {
    idKey: 'developmentTeamIds',
    label: 'developmentTeam',
    nameKey: 'developmentTeam',
    multiple: true,
  },
  {
    idKey: 'qaId',
    label: 'qa',
    nameKey: 'qa',
    multiple: false,
  },
] as const

const normalizeName = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const splitPeople = (value: unknown) =>
  String(value ?? '')
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '0')

const getUserKeys = (user: UserInfo) => {
  const keys = new Set<string>()
  const title = normalizeName(user.title)
  const lastName = normalizeName(user.lastName)
  const name = normalizeName(user.name)
  const secondName = normalizeName(user.secondName)

  if (title) {
    keys.add(title)
  }

  keys.add([lastName, name].filter(Boolean).join(' '))
  keys.add([name, lastName].filter(Boolean).join(' '))
  keys.add([lastName, name, secondName].filter(Boolean).join(' '))
  keys.add([name, secondName, lastName].filter(Boolean).join(' '))

  return Array.from(keys).filter(Boolean)
}

const buildUserIndex = (users: UserInfo[]): UserIndex => {
  const byId = new Map<string, UserInfo>()
  const byName = new Map<string, UserInfo[]>()

  for (const user of users) {
    byId.set(String(user.id), user)

    for (const key of getUserKeys(user)) {
      byName.set(key, [...(byName.get(key) ?? []), user])
    }
  }

  return { byId, byName, users }
}

const matchUserValue = (value: string, userIndex: UserIndex) => {
  const normalizedValue = normalizeName(value)

  if (!normalizedValue) {
    return { status: 'empty' as const }
  }

  const directUser = userIndex.byId.get(value.trim())

  if (directUser) {
    return { status: 'matched' as const, id: directUser.id }
  }

  const users = userIndex.byName.get(normalizedValue) ?? []

  if (users.length === 1) {
    return { status: 'matched' as const, id: users[0].id }
  }

  if (users.length > 1) {
    return { status: 'ambiguous' as const }
  }

  const matchingUsers = userIndex.users.filter((user) =>
    getUserKeys(user).some((key) => key.includes(normalizedValue)),
  )

  if (matchingUsers.length === 1) {
    return { status: 'matched' as const, id: matchingUsers[0].id }
  }

  if (matchingUsers.length > 1) {
    return { status: 'ambiguous' as const }
  }

  return { status: 'not_found' as const }
}

const matchUsers = (
  value: string | null,
  multiple: boolean,
  userIndex: UserIndex,
): MatchResult => {
  const values = multiple ? splitPeople(value) : splitPeople(value).slice(0, 1)

  if (!values.length) {
    return { status: 'empty', ids: [] }
  }

  const ids: string[] = []
  const notFound: string[] = []
  const ambiguous: string[] = []

  for (const item of values) {
    const match = matchUserValue(item, userIndex)

    if (match.status === 'matched') {
      ids.push(match.id)
    }

    if (match.status === 'not_found') {
      notFound.push(item)
    }

    if (match.status === 'ambiguous') {
      ambiguous.push(item)
    }
  }

  if (ambiguous.length) {
    return { status: 'ambiguous', ids, values: ambiguous }
  }

  if (notFound.length) {
    return { status: 'not_found', ids, values: notFound }
  }

  return { status: 'matched', ids: Array.from(new Set(ids)) }
}

const setProjectUserIds = (
  project: ReportProject,
  userIndex: UserIndex,
  warnings: string[],
) => {
  let changed = false

  for (const field of userFields) {
    const nameValue = project[field.nameKey]
    const currentIdValue = project[field.idKey]
    const result = matchUsers(nameValue, field.multiple, userIndex)

    if (result.status === 'empty') {
      if (currentIdValue) {
        project[field.idKey] = null
        changed = true
      }

      continue
    }

    if (result.status !== 'matched') {
      warnings.push(
        `project=${project.id} title="${project.title}" field=${field.label} status=${result.status} values="${result.values.join(', ')}"`,
      )
      continue
    }

    const nextValue = field.multiple ? result.ids.join(', ') : result.ids[0]

    if (currentIdValue !== nextValue) {
      project[field.idKey] = nextValue || null
      changed = true
    }
  }

  return changed
}

const mapReportProjectUserIds = async () => {
  const isDryRun = process.argv.includes('--dry-run')
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  try {
    const dataSource = app.get(DataSource)
    const bitrixService = app.get(BitrixService)
    const repository: Repository<ReportProject> =
      dataSource.getRepository(ReportProject)
    const projects = await repository.find()
    const users = await bitrixService.listAllUsers()
    const userIndex = buildUserIndex(users)
    const warnings: string[] = []
    let changed = 0

    for (const project of projects) {
      const shouldSave = setProjectUserIds(project, userIndex, warnings)

      if (shouldSave) {
        changed += 1

        if (!isDryRun) {
          await repository.save(project)
        }
      }
    }

    console.log(
      `Report project user ids mapping completed. projects=${projects.length}, users=${users.length}, changed=${changed}, dryRun=${isDryRun}`,
    )

    if (warnings.length) {
      console.warn(`Unmapped or ambiguous values: ${warnings.length}`)
      warnings.forEach((warning) => console.warn(warning))
    }
  } finally {
    await app.close()
  }
}

mapReportProjectUserIds().catch((error) => {
  console.error(error)
  process.exit(1)
})
