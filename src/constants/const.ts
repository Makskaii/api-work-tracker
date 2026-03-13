export enum TaskCodes {
  description = 'ufCrm14_1770731622242',
  stage = 'ufCrm14_1770890673468',
  estimateTime = 'ufCrm14_1770731674952',
  project = 'ufCrm14_1772011269',
  reportDate = 'ufCrm14_1771314375250',
  timeSpent = 'ufCrm14_1771314387497',
  comment = 'ufCrm14_1771314401297',
  sprintDateStart = 'ufCrm14_1771510367281',
}

export const Endpoints = {
  tasks: 'tasks.task.list',
  groups: 'sonet_group.get',
  users: 'user.get',
  crmItems: 'crm.item.list',
  crmFeilds: 'crm.item.fields',
  status: 'crm.status.list',
  lists: 'lists.element.get',
  item: 'crm.item.get',
}

export const EntityTypeIds = {
  reports: 1060,
  tasks: 1072,
}

export const TASK_SELECT_FIELDS = [
  'id',
  'title',
  'assignedById',
  'createdTime',
  'lastActivityTime',
  'stageId',
  'createdBy',
  'movedTime',
  TaskCodes.project,
  TaskCodes.estimateTime,
  TaskCodes.description,
  TaskCodes.stage,
  TaskCodes.comment,
  TaskCodes.reportDate,
  TaskCodes.timeSpent,
] as const
