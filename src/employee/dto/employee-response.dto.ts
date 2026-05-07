export class EmployeeResponseDto {
  id!: number
  employeeId!: string
  activityId!: string
  activityName!: string
  clientId!: string
  clientName!: string
  projectId!: string
  projectName!: string
  comment?: string | null
  hours!: string
  createdAt!: Date
  updatedAt!: Date
}
