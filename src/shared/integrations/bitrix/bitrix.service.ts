import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { Endpoints } from 'src/constants/const'
import { AnyObject } from 'src/types/types'
import { TaskProps } from 'src/types/tasks'
import { ReportProps } from 'src/types/reports'

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
}
