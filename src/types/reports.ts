import { DailyReportCodes } from 'src/constants/const'
import { TaskProps } from './tasks'

export interface Reports {
  id: number
  name: string
  timeSpent: number
  description: string
  date: Date
  projectId: number
}

export interface ReportProps {
  id: string
  title: string
  createdTime: string
  begindate: string
  [DailyReportCodes.project]: number
  [DailyReportCodes.company]?: number
  [DailyReportCodes.parentproject]?: number
  [DailyReportCodes.taskId]: string
  [DailyReportCodes.timeSpent]: string
  [DailyReportCodes.title]: string
  [DailyReportCodes.activityType]: number
  [DailyReportCodes.parentId]: number
  assignedById: string
  lastActivityTime: string
}

export type TaskWithTimeSpent = TaskProps & {
  timeSpent: number
  reports: ReportProps[]
}

export type TaskWithResult = TaskProps & {
  result: string
  timeSpent: number
  firstWeekTime?: number
  secondWeekTime?: number
  reports: ReportProps[]
  allReports?: ReportProps[]
}

export type GroupedTasksWithTimeSpent = Record<string, TaskWithTimeSpent[]>
