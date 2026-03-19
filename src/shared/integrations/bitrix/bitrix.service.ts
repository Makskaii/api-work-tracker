import { HttpService } from '@nestjs/axios'
import { Injectable } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'
import {
  DAILY_REPORT_SELECT,
  Endpoints,
  EntityTypeIds,
} from 'src/constants/const'
import { AnyObject } from 'src/types/types'

export interface BitrixUser {
  ID?: string | number
  id?: string | number
  NAME?: string
  LAST_NAME?: string
  SECOND_NAME?: string
  TITLE?: string
  name?: string
  lastName?: string
  secondName?: string
  title?: string
}

type BitrixUsersResult =
  | BitrixUser[]
  | {
      items?: BitrixUser[]
      users?: BitrixUser[]
    }
  | null
  | undefined

@Injectable()
export class BitrixService {
  constructor(private readonly httpService: HttpService) {}

  async listItems<T = Record<string, unknown>>(
    entityTypeId: number,
    params: {
      select?: readonly string[]
      filter?: AnyObject
      order?: AnyObject
    },
  ): Promise<T[]> {
    const response = await firstValueFrom(
      this.httpService.get(Endpoints.crmItems, {
        params: {
          entityTypeId,
          ...params,
        },
      }),
    )

    return response.data?.result?.items ?? []
  }

  getReportsByUser(
    userId: number,
    start: string,
    end: string,
  ): Promise<Record<string, unknown>[]> {
    return this.listItems(EntityTypeIds.reports, {
      select: DAILY_REPORT_SELECT,
      filter: {
        assignedById: userId,
        '>=begindate': start,
        '<=begindate': end,
      },
    })
  }

  async getUsersByIds(userIds: number[]): Promise<BitrixUser[]> {
    if (!userIds.length) {
      return []
    }

    const results = await Promise.allSettled(
      userIds.map(async (userId): Promise<BitrixUser | null> => {
        const response = await firstValueFrom(
          this.httpService.get(Endpoints.users, {
            params: {
              filter: {
                ID: userId,
              },
            },
          }),
        )

        const result = response.data?.result as BitrixUsersResult

        if (Array.isArray(result)) {
          return result[0] ?? null
        }

        if (result && Array.isArray(result.items)) {
          return result.items[0] ?? null
        }

        if (result && Array.isArray(result.users)) {
          return result.users[0] ?? null
        }

        return null
      }),
    )

    return results
      .filter(
        (item): item is PromiseFulfilledResult<BitrixUser | null> =>
          item.status === 'fulfilled',
      )
      .map((item) => item.value)
      .filter((item): item is BitrixUser => Boolean(item))
  }
}
