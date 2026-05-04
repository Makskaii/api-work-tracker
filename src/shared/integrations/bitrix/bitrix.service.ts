import { HttpService } from '@nestjs/axios'
import { Injectable } from '@nestjs/common'
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

@Injectable()
export class BitrixService {
  constructor(private readonly httpService: HttpService) {}

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

  async listAllItems<T>(params: {
    entityTypeId: number
    select?: readonly string[]
    filter?: AnyObject
  }): Promise<T[]> {
    let start = 0
    let hasNextPage = true
    const items: T[] = []

    while (hasNextPage) {
      const response = await firstValueFrom(
        this.httpService.get(Endpoints.crmItems, {
          params: {
            ...params,
            start,
          },
        }),
      )

      const pageItems = response.data?.result?.items

      if (Array.isArray(pageItems)) {
        items.push(...pageItems)
      }

      const next = response.data?.next

      if (typeof next === 'number' && next > 0) {
        start = next
      } else {
        hasNextPage = false
      }
    }

    return items
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

    const results = await Promise.all(
      userIds.map(async (userId): Promise<UserInfo | null> => {
        const response = await firstValueFrom(
          this.httpService.get<BitrixUsersApiResponse>(Endpoints.users, {
            params: {
              filter: {
                ID: userId,
              },
            },
          }),
        )

        const user = response.data.result?.[0]

        if (!user?.ID) {
          return null
        }

        return {
          id: String(user.ID),
          title: this.buildUserTitle(user),
        }
      }),
    )

    return results.filter((item): item is UserInfo => item !== null)
  }

  private buildUserTitle(user: BitrixUserResponse): string {
    if (user.TITLE?.trim()) {
      return user.TITLE.trim()
    }

    return [user.LAST_NAME, user.NAME].filter(Boolean).join(' ').trim()
  }
}
