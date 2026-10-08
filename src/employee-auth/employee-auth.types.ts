export type EmployeeAbilityRule = { action: string; subject: string }

export type EmployeeIdentity = {
  user: { id: number; name: string; departmentIds: number[]; isAdmin: boolean }
  rules: EmployeeAbilityRule[]
  portalOrigin: string
}

/** Server-only: the access token must never be serialized into a frontend response. */
export type ResolvedEmployeeSession = {
  accessToken: string
  identity: EmployeeIdentity
  csrfToken: string
  sessionId: string
  expiresAt: number
}

export type EmployeeSessionResponse = EmployeeIdentity & {
  csrfToken: string
  expiresAt: string
}

export type StoredEmployeeSession = {
  version: 1
  accessToken: string
  refreshToken: string
  tokenExpiresAt: number
  userId: number
  expiresAt: number
  csrfToken: string
  identity: EmployeeIdentity
  identityCheckedAt: number
}
