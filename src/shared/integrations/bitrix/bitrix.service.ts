import { HttpService } from '@nestjs/axios'
import { Injectable } from '@nestjs/common'
import { firstValueFrom } from 'rxjs'
import {
  DAILY_REPORT_SELECT,
  Endpoints,
  EntityTypeIds,
} from 'src/constants/const'
import {
  BitrixUserResponse,
  BitrixUsersApiResponse,
  UserInfo,
} from 'src/types/bitrix'
import { ReportProps } from 'src/types/reports'
import { AnyObject } from 'src/types/types'

@Injectable()
export class BitrixService {
  constructor(private readonly httpService: HttpService) {}

  async listItems<T>(
    entityTypeId: number,
    select?: readonly string[],
    filter?: AnyObject,
  ): Promise<T[]> {
    const response = await firstValueFrom(
      this.httpService.get(Endpoints.crmItems, {
        params: {
          entityTypeId,
          select,
          filter,
        },
      }),
    )

    return response.data?.result?.items ?? []
  }

  getReportsByUser(
    userId: number,
    start: string,
    end: string,
  ): Promise<ReportProps[]> {
    return this.listItems<ReportProps>(
      EntityTypeIds.reports,
      DAILY_REPORT_SELECT,
      {
        assignedById: userId,
        '>=begindate': start,
        '<=begindate': end,
      },
    )
  }

  async getUsersByIds(userIds: number[]): Promise<UserInfo[]> {
    if (!userIds.length) {
      return []
    }

    const results = await Promise.allSettled(
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

    return results
      .filter(
        (item): item is PromiseFulfilledResult<UserInfo | null> =>
          item.status === 'fulfilled',
      )
      .map((item) => item.value)
      .filter((item): item is UserInfo => Boolean(item))
  }

  private buildUserTitle(user: BitrixUserResponse): string {
    if (user.TITLE?.trim()) {
      return user.TITLE.trim()
    }

    return [user.LAST_NAME, user.NAME, user.SECOND_NAME]
      .filter(Boolean)
      .join(' ')
      .trim()
  }
}
