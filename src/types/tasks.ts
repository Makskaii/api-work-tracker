import { TaskCodes } from 'src/constants/const'

export interface Tasks {
  id: number
  name: string
  status: string
  description: string
  employeeId: number
  created: Date
  updated: Date
  completed: Date
}

export interface TaskProps {
  id: string
  title: string
  createdBy: string
  assignedById: number
  createdTime: string
  lastActivityTime: string
  stageId: string
  movedTime: string
  [TaskCodes.project]: number
  [TaskCodes.estimateTime]: string
  [TaskCodes.description]: string
  [TaskCodes.stage]: string
  [TaskCodes.timeSpent]: string
  [TaskCodes.sprintDateStart]: string | string[]
}
