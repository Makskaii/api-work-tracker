import { ProjectCodes } from 'src/constants/const'
import { UserInfo } from 'src/types/bitrix'

export type ClientCompanyDto = {
  id: number
  title?: string
  [key: string]: unknown
}

export type ClientProjectDto = {
  id: number
  title: string
  clientId: number | null
  projectId: string
  [key: string]: unknown
}

export type ClientTeamRoleCode = 'pm' | 'analytic' | 'devs' | 'qa'

export type ClientTeamUserDto = {
  id: string
  title: string
  name?: string
  lastName?: string
  secondName?: string
  department?: number[]
  workPosition?: string
  photo?: string
}

export type ClientTeamRoleDto = {
  roleCode: ClientTeamRoleCode
  roleTitle: string
  fieldCode: ProjectCodes
  userIds: number[]
  users: ClientTeamUserDto[]
}

export type ClientTeamDto = {
  roles: ClientTeamRoleDto[]
}

export type ClientStatsDto = {
  period: {
    start: string
    end: string
  }
  tasks: {
    count: number
    totalTime: number
  }
  communications: {
    totalTime: number
    internal: {
      activityType: string
      count: number
      totalTime: number
    }
    external: {
      activityType: string
      count: number
      totalTime: number
    }
  }
}

export const toClientTeamUserDto = (user: UserInfo): ClientTeamUserDto => ({
  id: user.id,
  title: user.title,
  name: user.name,
  lastName: user.lastName,
})
