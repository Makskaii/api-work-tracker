export enum TaskCodes {
  description = 'ufCrm14_1770731622242',
  stage = 'ufCrm14_1770890673468',
  estimateTime = 'ufCrm14_1770731674952',
  project = 'ufCrm14_1774264018',
  client = 'ufCrm14_1772011269',
  reportDate = 'ufCrm14_1771314375250',
  timeSpent = 'ufCrm14_1771314387497',
  comment = 'ufCrm14_1771314401297',
  sprintDateStart = 'ufCrm14_1771510367281',
  result = 'ufCrm14_1774261248',
}

export enum DailyReportCodes {
  title = 'ufCrm11_1770627903531',
  timeSpent = 'ufCrm11_1770627880479',
  taskId = 'ufCrm11_1770627808462',
  project = 'ufCrm11_1772012010',
  activityType = 'ufCrm11_1770804288638',
  parentId = 'parentId1072',
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

export enum DtoFieldsDailyReports {
  title = 'ufCrm11_1770627903531',
  timeSpent = 'ufCrm11_1770627880479',
  taskId = 'ufCrm11_1770627808462',
  project = 'ufCrm11_1772012010',
  activityType = 'ufCrm11_1770804288638',
  parentId = 'parentId1072',
}

export enum ActivityType {
  development = 269,
  clientCall = 270,
  analitycsCall = 271,
  dash = 272,
  devsCall = 275,
}

export const DAILY_REPORT_SELECT = [
  'id',
  'title',
  'begindate',
  'assignedById',
  DtoFieldsDailyReports.title,
  DtoFieldsDailyReports.timeSpent,
  DtoFieldsDailyReports.project,
  DtoFieldsDailyReports.taskId,
  DtoFieldsDailyReports.activityType,
  DtoFieldsDailyReports.parentId,
]

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
  TaskCodes.sprintDateStart,
  TaskCodes.result,
] as const
