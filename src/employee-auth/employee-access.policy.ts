import { ForbiddenException } from '@nestjs/common'
import type { EmployeeAbilityRule, EmployeeIdentity } from './employee-auth.types'

const positiveId = (value: unknown): number | null => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export function employeeIdentity(
  rawUser: Record<string, unknown>,
  isAdmin: boolean,
  departments: Array<Record<string, unknown>>,
  portalOrigin: string,
): EmployeeIdentity {
  const id = positiveId(rawUser.ID)
  const active = rawUser.ACTIVE === true || rawUser.ACTIVE === 'Y' || rawUser.ACTIVE === 1 || rawUser.ACTIVE === '1'
  const rawDepartments = Array.isArray(rawUser.UF_DEPARTMENT) ? rawUser.UF_DEPARTMENT : [rawUser.UF_DEPARTMENT]
  const departmentIds = Array.from(new Set(rawDepartments.map(positiveId).filter((value): value is number => value !== null)))
  const extranet = rawUser.EXTRANET_USER === true || rawUser.EXTRANET_USER === 'Y' ||
    rawUser.IS_EXTRANET === true || rawUser.IS_EXTRANET === 'Y' || rawUser.USER_TYPE === 'extranet'
  if (!id || !active || extranet || (!isAdmin && !departmentIds.length)) {
    throw new ForbiddenException('Доступ к Work Tracker разрешён только активным сотрудникам портала')
  }

  const children = new Map<number, number[]>()
  const heads = new Set<number>()
  for (const row of departments) {
    const departmentId = positiveId(row.ID)
    const parentId = positiveId(row.PARENT)
    if (!departmentId || (row.PARENT != null && row.PARENT !== '' && row.PARENT !== 0 && row.PARENT !== '0' && parentId === null)) {
      throw new ForbiddenException('Не удалось подтвердить структуру отделов Битрикс24')
    }
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), departmentId])
    const head = positiveId(row.UF_HEAD)
    if (head) heads.add(head)
  }
  const descendants = (roots: number[]) => {
    const found = new Set(roots)
    const queue = [...roots]
    for (let index = 0; index < queue.length; index++) {
      for (const child of children.get(queue[index]) ?? []) {
        if (found.has(child)) continue
        found.add(child)
        queue.push(child)
      }
    }
    return found
  }
  const reportDepartments = descendants([23, 25])
  const salesDepartments = descendants([19])
  const rules: EmployeeAbilityRule[] = []
  const add = (action: string, subject: string) => {
    if (!rules.some((rule) => rule.action === action && rule.subject === subject)) rules.push({ action, subject })
  }
  if (isAdmin || heads.has(id) || [16, 89].includes(id)) {
    add('read', 'post')
    add('create-client', 'client')
  }
  if (departmentIds.some((departmentId) => reportDepartments.has(departmentId))) add('read', 'post')
  if ([10, 16].includes(id)) add('read', `employee-${id}`)
  if (departmentIds.includes(25)) add('create-client', 'client')
  if (departmentIds.some((departmentId) => salesDepartments.has(departmentId))) {
    add('read', 'sales-report')
    add('create-client', 'client')
  }
  if (!rules.length) throw new ForbiddenException('У вашего отдела нет доступа к Work Tracker')
  const name = [rawUser.NAME, rawUser.LAST_NAME].filter((part) => typeof part === 'string' && part.trim()).join(' ').trim()
  return { user: { id, name: name || `Сотрудник №${id}`, departmentIds, isAdmin }, rules, portalOrigin }
}
