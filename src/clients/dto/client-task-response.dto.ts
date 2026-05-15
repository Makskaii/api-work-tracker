import { ClientTaskStatuses, TaskCodes } from 'src/constants/const'

export type ClientTaskStatus =
  (typeof ClientTaskStatuses)[keyof typeof ClientTaskStatuses]

export class ClientTaskResponseDto {
  id: string
  title: string
  status: ClientTaskStatus;
  [TaskCodes.result]?: string | null;
  [TaskCodes.hours]?: string | number | null;
  [TaskCodes.client]?: string | number | null;
  [TaskCodes.parentproject]?: string | number | null;
  [TaskCodes.description]?: string | null;
  [TaskCodes.comment]?: string | null
}
