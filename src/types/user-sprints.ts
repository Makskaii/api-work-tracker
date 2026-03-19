export enum ActivityType {
  development = 269,
  clientCall = 270,
  analitycsCall = 271,
  dash = 272,
  devsCall = 275,
}

export type ActivitiesMap = {
  [ActivityType.development]: number
  [ActivityType.clientCall]: number
  [ActivityType.analitycsCall]: number
  [ActivityType.dash]: number
  [ActivityType.devsCall]: number
}

export type SprintEmployeeStatsResponse = {
  id: string
  title: string
  availableTime: number
  timeSpent: number
  effectivity: string
  comment: string
  [ActivityType.development]: number
  [ActivityType.clientCall]: number
  [ActivityType.analitycsCall]: number
  [ActivityType.dash]: number
  [ActivityType.devsCall]: number
}
