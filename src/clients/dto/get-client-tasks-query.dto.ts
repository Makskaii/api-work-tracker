import { IsDateString, IsEnum, IsOptional } from 'class-validator'

export enum ClientTasksStatusFilter {
  All = 'all',
  InWork = 'inWork',
  Done = 'done',
  Approval = 'approval',
}

export class GetClientTasksQueryDto {
  @IsOptional()
  @IsDateString()
  createdFrom?: string

  @IsOptional()
  @IsDateString()
  start?: string

  @IsOptional()
  @IsDateString()
  end?: string

  @IsOptional()
  @IsEnum(ClientTasksStatusFilter)
  status?: ClientTasksStatusFilter
}
