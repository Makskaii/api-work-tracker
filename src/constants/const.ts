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

  linkedTasks = 'ufCrm14_1775462592',
  hours = 'ufCrm14_1776177413413',
  deadline = 'ufCrm14_1775128557733',
  company = 'ufCrm14_1775127945',
  parentproject = 'parentId1092',
  taskType = 'ufCrm14_1775231676',
}

export enum ProjectCodes {
  pm = 'ASSIGNED_BY_ID',
  analytic = 'ufCrm20_1777028495',
  devs = 'ufCrm20_1777028537',
  qa = 'ufCrm20_1777028582',
  company = 'ufCrm20_1774879746',
  parentProject = 'ufCrm20_1774856819',
}

export enum DailyReportCodes {
  title = 'ufCrm11_1770627903531',
  timeSpent = 'ufCrm11_1770627880479',
  taskId = 'ufCrm11_1770627808462',
  client = 'ufCrm11_1772012010',
  project = 'ufCrm11_1774018669',
  activityType = 'ufCrm11_1774427281',
  parentId = 'parentId1072',
  company = 'ufCrm11_1775128268',
  parentproject = 'ufCrm11_1775128299',
}

export const Endpoints = {
  tasks: 'tasks.task.list',
  groups: 'sonet_group.get',
  users: 'user.get',
  crmItems: 'crm.item.list',
  crmItemAdd: 'crm.item.add',
  crmItemUpdate: 'crm.item.update',
  crmTimelineCommentAdd: 'crm.timeline.comment.add',
  crmTimelineCommentUpdate: 'crm.timeline.comment.update',
  crmFeilds: 'crm.item.fields',
  status: 'crm.status.list',
  lists: 'lists.element.get',
  item: 'crm.item.get',
  company: 'crm.company.get',
  department: 'department.get',
  calls: 'voximplant.statistic.get',
}

export const EntityTypeIds = {
  reports: 1060,
  tasks: 1072,
  projects: 1092,
  default: 2,
  companies: 4,
}

export const CLIENT_TASK_PROPOSAL_CATEGORY_ID = 18
export const CLIENT_TASK_PROPOSAL_STAGE_ID = 'DT1072_18:UC_8NADXD'
export const CLIENT_TASK_APPROVAL_STAGE_ID = 'DT1072_18:UC_ZO5QNH'
export const CLIENT_TASK_PROPOSAL_MAX_FILES = 10
export const CLIENT_TASK_PROPOSAL_MAX_FILE_SIZE = 10 * 1024 * 1024

export const TaskStageIds = {
  backlog: 'DT1072_18:NEW',
  sprint: 'DT1072_18:PREPARATION',
  inWork: 'DT1072_18:CLIENT',
  done: 'DT1072_18:UC_6JNSDG',
  testing: 'DT1072_18:UC_5GG9S1',
  waiting: 'DT1072_18:UC_A9IWFS',
  docs: 'DT1072_18:UC_K596F0',
  newProposal: CLIENT_TASK_PROPOSAL_STAGE_ID,
  approval: CLIENT_TASK_APPROVAL_STAGE_ID,
} as const

export const ClientTaskStatuses = {
  done: 'Done',
  inWork: 'In work',
  backlog: 'Backlog',
  newProposal: 'New proposal',
  approval: 'Approval',
} as const

export const CLIENT_TASK_IN_WORK_STAGE_IDS = [
  TaskStageIds.sprint,
  TaskStageIds.inWork,
  TaskStageIds.testing,
  TaskStageIds.waiting,
  TaskStageIds.docs,
] as const

export const CLIENT_TASK_APPROVAL_STAGE_IDS = [TaskStageIds.approval] as const
export const CLIENT_TASK_NEW_PROPOSAL_STAGE_IDS = [
  TaskStageIds.newProposal,
] as const

export const CLIENT_TASK_DONE_STAGE_IDS = [TaskStageIds.done] as const
export const CLIENT_TASK_BACKLOG_STAGE_IDS = [TaskStageIds.backlog] as const

export const CLIENT_TASK_SELECT_FIELDS = [
  'id',
  'title',
  'stageId',
  TaskCodes.result,
  TaskCodes.hours,
  TaskCodes.client,
  TaskCodes.parentproject,
  TaskCodes.description,
  TaskCodes.comment,
] as const

export enum DtoFieldsDailyReports {
  title = 'ufCrm11_1770627903531',
  timeSpent = 'ufCrm11_1770627880479',
  taskId = 'ufCrm11_1770627808462',
  project = 'ufCrm11_1772012010',
  activityType = 'ufCrm11_1770804288638',
  parentId = 'parentId1072',
}

export enum ClientsCodes {
  client = 'ufCrm20_1774879746',
  title = 'ufCrm20_1771940818371',
  parentProject = 'ufCrm20_1774856819',
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
  TaskCodes.client,
  TaskCodes.company,
  TaskCodes.project,
  TaskCodes.estimateTime,
  TaskCodes.description,
  TaskCodes.stage,
  TaskCodes.comment,
  TaskCodes.reportDate,
  TaskCodes.timeSpent,
  TaskCodes.sprintDateStart,
  TaskCodes.result,
  TaskCodes.linkedTasks,
  TaskCodes.hours,
  TaskCodes.deadline,
  TaskCodes.parentproject,
] as const

export const reportSelectFields = [
  'id',
  'title',
  'begindate',
  DailyReportCodes.title,
  DailyReportCodes.timeSpent,
  DailyReportCodes.project,
  DailyReportCodes.company,
  DailyReportCodes.parentproject,
  DailyReportCodes.taskId,
  DailyReportCodes.activityType,
  'assignedById',
  'createdTime',
  'lastActivityTime',
  `parentId${EntityTypeIds.tasks}`,
]
