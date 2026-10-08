import { ForbiddenException } from '@nestjs/common'
import { employeeIdentity } from './employee-access.policy'

const departments = [
  { ID: '23', PARENT: '1', UF_HEAD: '16' }, { ID: '25', PARENT: '1', UF_HEAD: '91' },
  { ID: '19', PARENT: '1' }, { ID: '30', PARENT: '23' }, { ID: '31', PARENT: '25' },
  { ID: '32', PARENT: '19' }, { ID: '40', PARENT: '1' },
]
const user = (id: number, departmentIds: number[] = [23]) => ({ ID: String(id), ACTIVE: 'Y', NAME: 'Имя', LAST_NAME: 'Фамилия', UF_DEPARTMENT: departmentIds })
const rules = (id: number, departmentIds: number[], admin = false) => employeeIdentity(user(id, departmentIds), admin, departments, 'https://crm.example.test').rules

describe('employee permission policy', () => {
  it.each([[23], [30], [25], [31]])('grants developer/analytics departments and descendants reports: %j', (ids) => {
    expect(rules(77, [ids])).toContainEqual({ action: 'read', subject: 'post' })
  })
  it('preserves direct analytics client management without granting it to descendants', () => {
    expect(rules(77, [25])).toContainEqual({ action: 'create-client', subject: 'client' })
    expect(rules(77, [31])).not.toContainEqual({ action: 'create-client', subject: 'client' })
  })
  it.each([19, 32])('grants sales access separately from development reports: %s', (department) => {
    expect(rules(77, [department])).toEqual([
      { action: 'read', subject: 'sales-report' }, { action: 'create-client', subject: 'client' },
    ])
  })
  it.each([16, 89, 91])('retains the existing individual/head grants: %s', (id) => {
    expect(rules(id, [40])).toContainEqual({ action: 'read', subject: 'post' })
    expect(rules(id, [40])).toContainEqual({ action: 'create-client', subject: 'client' })
  })
  it('allows actual Bitrix administrators even without a department', () => {
    expect(rules(77, [], true)).toContainEqual({ action: 'read', subject: 'post' })
  })
  it('preserves special employee stats access', () => {
    expect(rules(10, [40])).toEqual([{ action: 'read', subject: 'employee-10' }])
    expect(rules(16, [40])).toContainEqual({ action: 'read', subject: 'employee-16' })
  })
  it('deduplicates roles when administrator, head and department membership overlap', () => {
    expect(rules(16, [23, 25], true)).toEqual([
      { action: 'read', subject: 'post' }, { action: 'create-client', subject: 'client' },
      { action: 'read', subject: 'employee-16' },
    ])
  })
  it.each([
    { ...user(77), ACTIVE: 'N' }, { ...user(77), ID: '0' },
    { ...user(77), EXTRANET_USER: 'Y' }, { ...user(77), UF_DEPARTMENT: [0] },
    { ...user(77), UF_DEPARTMENT: [40] },
  ])('fails closed for inactive, invalid, external or unauthorized users', (rawUser) => {
    expect(() => employeeIdentity(rawUser, false, departments, 'https://crm.example.test')).toThrow(ForbiddenException)
  })
  it('does not use malformed department hierarchy for authorization', () => {
    expect(() => employeeIdentity(user(77), false, [{ ID: 23, PARENT: 'invalid' }], 'https://crm.example.test')).toThrow(ForbiddenException)
  })
})
