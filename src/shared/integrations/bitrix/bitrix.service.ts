import { Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { Endpoints } from 'src/constants/const'
import { AnyObject } from 'src/types/types'
import { TaskProps } from 'src/types/tasks'

@Injectable()
export class BitrixService {
  constructor(private readonly httpService: HttpService) {}

  async listItems(
    entityTypeId: number,
    select?: readonly string[],
    filter?: AnyObject,
  ): Promise<TaskProps[]> {
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
