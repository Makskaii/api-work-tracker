import { EmployeeResponseDto } from './dto/employee-response.dto'
import { Employee } from './entity/employee.entity'

export const toEmployeeResponseDto = (
  employee: Employee,
): EmployeeResponseDto => ({
  id: employee.id,
  employeeId: employee.employeeId,
  activityId: employee.activityId,
  activityName: employee.activityName,
  clientId: employee.clientId,
  clientName: employee.clientName,
  projectId: employee.projectId,
  projectName: employee.projectName,
  comment: employee.comment,
  hours: employee.hours,
  createdAt: employee.createdAt,
  updatedAt: employee.updatedAt,
})
