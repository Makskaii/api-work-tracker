export type BitrixUserResponse = {
  ID?: string | number
  NAME?: string
  LAST_NAME?: string
  SECOND_NAME?: string
  TITLE?: string
}

export type UserInfo = {
  id: string
  title: string
}

export type BitrixUsersApiResponse = {
  result: BitrixUserResponse[]
}
