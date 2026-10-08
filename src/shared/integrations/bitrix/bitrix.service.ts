import { HttpService } from '@nestjs/axios'
import { BadGatewayException, Injectable } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'
import {
  ClientsCodes,
  DAILY_REPORT_SELECT,
  Endpoints,
  EntityTypeIds,
} from 'src/constants/const'
import {
  BitrixClientProjects,
  BitrixClients,
  BitrixUserResponse,
  BitrixUsersApiResponse,
  ClientProjects,
  UserInfo,
} from 'src/types/bitrix'
import { ReportProps } from 'src/types/reports'
import { AnyObject } from 'src/types/types'

const CREATE_REJECTION_CODES = new Set([
  'NOT_FOUND', 'ACCESS_DENIED', 'allowed_only_intranet_user',
  'CRM_FIELD_ERROR_VALUE_NOT_VALID', '100', 'CREATE_DYNAMIC_ITEM_RESTRICTED',
  'NO_AUTH_FOUND', 'INVALID_REQUEST', 'INVALID_CREDENTIALS', 'ERROR_METHOD_NOT_FOUND',
  'insufficient_scope', 'expired_token', 'user_access_error', 'PORTAL_DELETED',
])

/** A documented validation/auth rejection means CRM did not create an item. */
export class BitrixItemCreateRejectedException extends BadGatewayException {
  constructor() {
    super('Битрикс24 отклонил создание элемента. Проверьте обязательные поля и права доступа')
  }
}

export class BitrixCompanyCreateRejectedException extends BadGatewayException {
  constructor() {
    super('Битрикс24 отклонил создание компании. Проверьте обязательные поля и права доступа')
  }
}
@Injectable()
export class BitrixService {
  constructor(private readonly httpService: HttpService) {}

  /** Trusted server-side department hierarchy; never accepts a caller-supplied portal. */
  async listDepartments(): Promise<Array<Record<string, unknown>>> {
    const departments: Array<Record<string, unknown>> = []
    let start = 0
    try {
      for (let page = 0; page < 1000; page++) {
        const { data } = await firstValueFrom(this.httpService.get('department.get', { params: { start } }))
        if (!data || data.error || !Array.isArray(data.result) || data.result.some((item: unknown) => !item || typeof item !== 'object' || Array.isArray(item))) {
          throw new Error('Invalid departments')
        }
        departments.push(...data.result)
        if (data.next == null) return departments
        const next = Number(data.next)
        if (!Number.isSafeInteger(next) || next <= start || !data.result.length) throw new Error('Invalid pagination')
        start = next
      }
      throw new Error('Department pagination exceeded')
    } catch {
      throw new BadGatewayException('Не удалось проверить отделы и права сотрудников в Битрикс24')
    }
  }

  async listItems<T>({
    entityTypeId,
    filter,
    select,
    start,
  }: {
    entityTypeId: number
    select?: readonly string[]
    filter?: AnyObject
    start?: number
  }): Promise<T[]> {
    const response = await firstValueFrom(
      this.httpService.get(Endpoints.crmItems, {
        params: {
          entityTypeId,
          select,
          filter,
          start,
        },
      }),
    )

    return response.data?.result?.items ?? []
  }

  async getItem<T>({
    entityTypeId,
    id,
  }: {
    entityTypeId: number
    id: number
  }): Promise<T | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.item, {
          entityTypeId,
          id,
          useOriginalUfNames: 'N',
        }),
      )

      if (response.data?.error) {
        throw new BadGatewayException(response.data.error_description)
      }

      return response.data?.result?.item ?? null
    } catch (error) {
      throw new BadGatewayException(this.getBitrixErrorMessage(error))
    }
  }

  async addItem<T>({
    entityTypeId,
    fields,
  }: {
    entityTypeId: number
    fields: AnyObject
  }): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.crmItemAdd, {
          entityTypeId,
          fields,
        }),
      )

      if (response.data?.error) {
        if (CREATE_REJECTION_CODES.has(String(response.data.error))) {
          throw new BitrixItemCreateRejectedException()
        }
        throw new BadGatewayException('Не удалось подтвердить создание элемента в Битрикс24')
      }

      const item = response.data?.result?.item

      if (!item) {
        throw new BadGatewayException('Bitrix item was not created')
      }

      return item
    } catch (error) {
      if (error instanceof BitrixItemCreateRejectedException) throw error
      const rejection = error as { response?: { data?: { error?: unknown } } }
      if (CREATE_REJECTION_CODES.has(String(rejection?.response?.data?.error))) {
        throw new BitrixItemCreateRejectedException()
      }
      throw new BadGatewayException('Не удалось подтвердить создание элемента в Битрикс24. Повторите сохранение позже')
    }
  }

  async updateItem<T>({
    entityTypeId,
    id,
    fields,
  }: {
    entityTypeId: number
    id: number
    fields: AnyObject
  }): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.crmItemUpdate, {
          entityTypeId,
          id,
          fields,
        }),
      )

      if (response.data?.error) {
        throw new BadGatewayException(response.data.error_description)
      }

      const item = response.data?.result?.item

      if (!item) {
        throw new BadGatewayException('Bitrix item was not updated')
      }

      return item
    } catch (error) {
      throw new BadGatewayException(this.getBitrixErrorMessage(error))
    }
  }

  async addTimelineComment({
    entityId,
    entityType,
    comment,
  }: {
    entityId: number
    entityType: string
    comment: string
  }): Promise<number> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.crmTimelineCommentAdd, {
          fields: {
            ENTITY_ID: entityId,
            ENTITY_TYPE: entityType,
            COMMENT: comment,
          },
        }),
      )

      if (response.data?.error) {
        throw new BadGatewayException(response.data.error_description)
      }

      const commentId = Number(response.data?.result)

      if (!Number.isFinite(commentId) || commentId <= 0) {
        throw new BadGatewayException('Bitrix timeline comment was not created')
      }

      return commentId
    } catch (error) {
      throw new BadGatewayException(this.getBitrixErrorMessage(error))
    }
  }

  async updateTimelineComment({
    id,
    comment,
    files,
    ownerTypeId,
    ownerId,
  }: {
    id: number
    comment: string
    files: readonly BitrixTimelineFile[]
    ownerTypeId?: number
    ownerId?: number
  }): Promise<number> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.crmTimelineCommentUpdate, {
          id,
          fields: {
            COMMENT: comment,
            FILES: files,
          },
          ...(ownerTypeId ? { ownerTypeId } : {}),
          ...(ownerId ? { ownerId } : {}),
        }),
      )

      if (response.data?.error) {
        throw new BadGatewayException(response.data.error_description)
      }

      const updatedCommentId = Number(response.data?.result)

      if (!Number.isFinite(updatedCommentId) || updatedCommentId <= 0) {
        throw new BadGatewayException('Bitrix timeline comment was not updated')
      }

      return updatedCommentId
    } catch (error) {
      throw new BadGatewayException(this.getBitrixErrorMessage(error))
    }
  }

  async getCompany<T>(id: number): Promise<T | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.company, {
          id,
          ID: id,
        }),
      )

      if (response.data?.error) {
        throw new BadGatewayException(response.data.error_description)
      }

      return response.data?.result ?? null
    } catch (error) {
      throw new BadGatewayException(this.getBitrixErrorMessage(error))
    }
  }

  async addCompany(fields: AnyObject): Promise<number> {
    try {
      const { data } = await firstValueFrom(this.httpService.post(Endpoints.companyAdd, {
        fields,
        params: { REGISTER_SONET_EVENT: 'N' },
      }))
      if (data && Object.hasOwn(data, 'error')) {
        if (CREATE_REJECTION_CODES.has(String(data.error))) throw new BitrixCompanyCreateRejectedException()
        throw new BadGatewayException('Не удалось подтвердить создание компании в Битрикс24')
      }
      const id = data?.result
      if ((typeof id !== 'number' && typeof id !== 'string') || !/^\d+$/.test(String(id)) ||
        !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
        throw new BadGatewayException('Не удалось подтвердить создание компании в Битрикс24')
      }
      return Number(id)
    } catch (error) {
      if (error instanceof BitrixCompanyCreateRejectedException) throw error
      const rejection = error as { response?: { data?: { error?: unknown } } }
      if (CREATE_REJECTION_CODES.has(String(rejection?.response?.data?.error))) {
        throw new BitrixCompanyCreateRejectedException()
      }
      throw new BadGatewayException('Не удалось подтвердить создание компании в Битрикс24. Повторите сохранение позже')
    }
  }

  async listAllCompanies<T>(params: { filter: AnyObject; select: readonly string[] }): Promise<T[]> {
    try {
      const companies: T[] = []
      let start = 0
      for (let page = 0; page < 10_000; page++) {
        const { data } = await firstValueFrom(this.httpService.post(Endpoints.companyList, {
          ...params, order: { ID: 'ASC' }, start,
        }))
        if (!data || Object.hasOwn(data, 'error') || !Array.isArray(data.result)) {
          throw new BadGatewayException('Битрикс24 вернул некорректный список компаний')
        }
        const items: T[] = data.result
        companies.push(...items)
        if (data.total != null && (!Number.isSafeInteger(Number(data.total)) || Number(data.total) < 0)) {
          throw new BadGatewayException('Битрикс24 вернул некорректный размер списка компаний')
        }
        if (data.next == null) {
          if (data.total != null && companies.length < Number(data.total)) {
            throw new BadGatewayException('Битрикс24 вернул неполный список компаний')
          }
          return companies
        }
        const next = Number(data.next)
        if (!Number.isSafeInteger(next) || next <= start || !items.length) {
          throw new BadGatewayException('Битрикс24 вернул некорректную страницу компаний')
        }
        start = next
      }
      throw new BadGatewayException('Превышено количество страниц компаний Битрикс24')
    } catch {
      throw new BadGatewayException('Не удалось проверить создание компании в Битрикс24. Повторите сохранение позже')
    }
  }

  async getListElements(iblockId: number): Promise<Array<{ id: number; title: string }>> {
    const items = new Map<number, { id: number; title: string }>()
    let start = 0
    try {
      for (;;) {
        const { data } = await firstValueFrom(this.httpService.post(Endpoints.lists, {
          IBLOCK_TYPE_ID: 'lists', IBLOCK_ID: iblockId, SELECT: ['ID', 'NAME'], FILTER: { ACTIVE: 'Y' }, start,
        }))
        if (data?.error || !Array.isArray(data?.result)) throw new BadGatewayException('Bitrix returned an invalid work activity list')
        for (const item of data.result) {
          const id = Number(item?.ID)
          if (!Number.isSafeInteger(id) || id <= 0 || typeof item.NAME !== 'string' || items.has(id)) throw new BadGatewayException('Bitrix returned an invalid work activity')
          items.set(id, { id, title: item.NAME })
        }
        if (data.next == null) {
          if (data.total != null && items.size < Number(data.total)) throw new BadGatewayException('Bitrix returned an incomplete work activity list')
          return [...items.values()]
        }
        const next = Number(data.next)
        if (!Number.isSafeInteger(next) || next <= start || items.size > 10000) throw new BadGatewayException('Bitrix work activity pagination is invalid')
        start = next
      }
    } catch {
      throw new BadGatewayException('Не удалось получить виды работ из Битрикса')
    }
  }

  async getListElementTitle(iblockId: number, id: number): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.lists, {
          IBLOCK_TYPE_ID: 'lists',
          IBLOCK_ID: iblockId,
          FILTER: { ID: id },
        }),
      )

      if (response.data?.error) {
        throw new BadGatewayException(response.data.error_description)
      }

      const result = response.data?.result
      const item = Array.isArray(result) ? result.at(0) : result
      return item?.NAME?.trim() || null
    } catch (error) {
      throw new BadGatewayException(this.getBitrixErrorMessage(error))
    }
  }

  async listAllItems<T>(params: {
    entityTypeId: number
    select?: readonly string[]
    filter?: AnyObject
  }): Promise<T[]> {
    try {
      let start = 0
      let hasNextPage = true
      let pageCount = 0
      const items: T[] = []

      while (hasNextPage) {
        if (++pageCount > 10_000) throw new BadGatewayException('Bitrix pagination exceeded the page limit')
        const response = await firstValueFrom(
          this.httpService.get(Endpoints.crmItems, {
            params: {
              ...params,
              start,
            },
          }),
        )

        if (response.data?.error) {
          throw new BadGatewayException(response.data.error_description || 'Bitrix returned an error')
        }
        const pageItems: unknown = response.data?.result?.items
        if (!Array.isArray(pageItems)) {
          throw new BadGatewayException('Bitrix returned an invalid items page')
        }
        items.push(...pageItems)

        const total = response.data?.total
        if (total != null && (!Number.isSafeInteger(Number(total)) || Number(total) < 0)) {
          throw new BadGatewayException('Bitrix returned an invalid total')
        }
        const next = response.data?.next
        if (next != null) {
          const nextOffset = Number(next)
          if (!Number.isSafeInteger(nextOffset) || nextOffset <= start || !pageItems.length) {
            throw new BadGatewayException('Bitrix returned an invalid pagination cursor')
          }
          start = nextOffset
        } else {
          if (total != null && items.length < Number(total)) {
            throw new BadGatewayException('Bitrix returned an incomplete items list')
          }
          hasNextPage = false
        }
      }

      return items
    } catch (error) {
      throw new BadGatewayException(
        `Bitrix listAllItems failed for entityTypeId=${params.entityTypeId}, filter=${JSON.stringify(params.filter ?? {})}: ${this.getBitrixErrorMessage(error)}`,
      )
    }
  }

  async getClients(): Promise<BitrixClients[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.lists, {
          IBLOCK_TYPE_ID: 'lists',
          IBLOCK_ID: '23',
          SELECT: ['ID', 'NAME'],
        }),
      )

      const items = response.data?.result

      if (!Array.isArray(items)) {
        console.warn('Expected items to be an array, but got:', items)
        return []
      }

      return items
    } catch (error) {
      console.error(`Failed to fetch fields`, error)
      return []
    }
  }

  async getDevelopers(filters: AnyObject): Promise<UserInfo[]> {
    const { data } = await firstValueFrom(
      this.httpService.post<{
        result: {
          ID: string
          NAME: string
          LAST_NAME: string
          UF_DEPARTMENT: number[]
          WORK_POSITION: string
          PERSONAL_PHOTO: string
        }[]
      }>(Endpoints.users, {
        filter: {
          ...filters,
        },
        select: [
          'NAME',
          'ID',
          'LAST_NAME',
          'UF_DEPARTMENT',
          'WORK_POSITION',
          'PERSONAL_PHOTO',
        ],
      }),
    )

    const developers = data?.result

    return developers.map((developer) => ({
      id: String(developer.ID),
      title: this.buildUserTitle(developer),
      department: developer.UF_DEPARTMENT,
    }))
  }

  async getClientsProjects(): Promise<BitrixClientProjects[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(Endpoints.lists, {
          IBLOCK_TYPE_ID: 'lists',
          IBLOCK_ID: '24',
        }),
      )

      const items = response.data?.result

      if (!Array.isArray(items)) {
        console.warn('Expected items to be an array, but got:', items)
        return []
      }

      return items
    } catch (error) {
      console.error(`Failed to fetch fields`, error)
      return []
    }
  }

  async getProjects(client: BitrixClients): Promise<ClientProjects[]> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(Endpoints.crmItems, {
          params: {
            entityTypeId: EntityTypeIds.projects,
            filter: {
              [ClientsCodes.client]: client.ID,
            },
            select: [
              'id',
              'createdBy',
              'updatedBy',
              'title',
              'movedBy',
              'createdTime',
              'updatedTime',
              'movedTime',
              'categoryId',
              'assignedById',
              'lastActivityBy',
              'lastActivityTime',
              ClientsCodes.title,
              ClientsCodes.client,
              'projectId',
            ],
          },
        }),
      )

      const items = response.data?.result.items

      if (!Array.isArray(items)) {
        console.warn('Expected items to be an array, but got:', items)
        return []
      }

      return items
    } catch (error) {
      console.error(`Failed to fetch projects`, error)
      return []
    }
  }

  async getReportsByUser(
    userId: number,
    start: string,
    end: string,
  ): Promise<ReportProps[]> {
    return await this.listItems<ReportProps>({
      entityTypeId: EntityTypeIds.reports,
      select: DAILY_REPORT_SELECT,
      filter: {
        assignedById: userId,
        '>=begindate': start,
        '<=begindate': end,
      },
    })
  }

  async getUsersByIds(userIds: number[]): Promise<UserInfo[]> {
    if (!userIds.length) {
      return []
    }

    const response = await firstValueFrom(
      this.httpService.get<BitrixUsersApiResponse>(Endpoints.users, {
        params: {
          filter: {
            '@ID': Array.from(new Set(userIds)),
          },
          select: [
            'ID',
            'NAME',
            'LAST_NAME',
            'SECOND_NAME',
            'TITLE',
            'UF_DEPARTMENT',
            'WORK_POSITION',
            'PERSONAL_PHOTO',
          ],
        },
      }),
    )

    return (response.data.result ?? [])
      .filter((user) => Boolean(user.ID))
      .map((user) => ({
        id: String(user.ID),
        title: this.buildUserTitle(user),
        name: user.NAME,
        lastName: user.LAST_NAME,
        secondName: user.SECOND_NAME,
        department: user.UF_DEPARTMENT,
        workPosition: user.WORK_POSITION,
        photo: user.PERSONAL_PHOTO,
      }))
  }

  async listAllUsers(): Promise<UserInfo[]> {
    const users: BitrixUserResponse[] = []
    let start = 0
    let hasNextPage = true

    while (hasNextPage) {
      const response = await firstValueFrom(
        this.httpService.get<BitrixUsersApiResponse>(Endpoints.users, {
          params: {
            start,
            select: [
              'ID',
              'NAME',
              'LAST_NAME',
              'SECOND_NAME',
              'TITLE',
              'UF_DEPARTMENT',
              'WORK_POSITION',
              'PERSONAL_PHOTO',
            ],
          },
        }),
      )

      users.push(...(response.data.result ?? []))

      const next = Number(response.data.next)

      if (Number.isFinite(next) && next > 0) {
        start = next
      } else {
        hasNextPage = false
      }
    }

    return users
      .filter((user) => Boolean(user.ID))
      .map((user) => ({
        id: String(user.ID),
        title: this.buildUserTitle(user),
        name: user.NAME,
        lastName: user.LAST_NAME,
        secondName: user.SECOND_NAME,
        department: user.UF_DEPARTMENT,
        workPosition: user.WORK_POSITION,
        photo: user.PERSONAL_PHOTO,
      }))
  }

  private buildUserTitle(user: BitrixUserResponse): string {
    if (user.TITLE?.trim()) {
      return user.TITLE.trim()
    }

    return [user.LAST_NAME, user.NAME].filter(Boolean).join(' ').trim()
  }

  private getBitrixErrorMessage(error: unknown): string {
    const responseData =
      typeof error === 'object' && error !== null && 'response' in error
        ? (
            error as {
              response?: {
                data?: {
                  error?: string
                  error_description?: string
                  message?: string
                }
              }
            }
          ).response?.data
        : null

    const responseDetails = responseData
      ? JSON.stringify(responseData)
      : undefined

    return (
      responseData?.error_description ??
      responseData?.message ??
      responseData?.error ??
      responseDetails ??
      (error instanceof Error ? error.message : 'Bitrix request failed')
    )
  }
}

export type BitrixTimelineFile = readonly [filename: string, content: string]
