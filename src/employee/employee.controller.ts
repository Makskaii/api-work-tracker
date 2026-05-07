import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { CreateEmployeeDto } from './dto/create-employee.dto'
import { EmployeeResponseDto } from './dto/employee-response.dto'
import { EmployeeService } from './employee.service'

@Controller('employee')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Post()
  create(
    @Body() createEmployeeDto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    return this.employeeService.create(createEmployeeDto)
  }

  @Get()
  findAll(): Promise<EmployeeResponseDto[]> {
    return this.employeeService.findAll()
  }

  @Get(':employeeId')
  findByEmployeeId(
    @Param('employeeId') employeeId: string,
  ): Promise<EmployeeResponseDto[]> {
    return this.employeeService.findByEmployeeId(employeeId)
  }
}
