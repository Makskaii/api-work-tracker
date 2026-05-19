import { ClientsCodes } from 'src/constants/const'

export type BitrixUserResponse = {
  ID?: string | number
  NAME?: string
  LAST_NAME?: string
  SECOND_NAME?: string
  TITLE?: string
  UF_DEPARTMENT?: number[]
  WORK_POSITION?: string
  PERSONAL_PHOTO?: string
}

export type UserInfo = {
  id: string
  title: string
  name?: string
  lastName?: string
  secondName?: string
  department?: number[]
  workPosition?: string
  photo?: string
}

export type BitrixUsersApiResponse = {
  result: BitrixUserResponse[]
}

export interface BitrixClients {
  ID: string
  NAME: string
}

export interface ClientProjects {
  id: number
  createdBy: number
  updatedBy: number
  title: string
  movedBy: number
  createdTime: string
  updatedTime: string
  movedTime: string
  categoryId: number
  assignedById: number
  lastActivityBy: number
  lastActivityTime: string
  [ClientsCodes.title]: string
  [ClientsCodes.client]: number
  projectId?: string
}

export interface BitrixClientProjects {
  ID: string
  NAME: string
  PROPERTY_87: {
    [key: string]: string
  }
}
