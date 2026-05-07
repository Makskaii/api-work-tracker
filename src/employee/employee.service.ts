import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateEmployeeDto } from './dto/create-employee.dto'
import { EmployeeResponseDto } from './dto/employee-response.dto'
import { toEmployeeResponseDto } from './employee.mapper'
import { Employee } from './entity/employee.entity'

@Injectable()
export class EmployeeService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
  ) {}

  async create(
    createEmployeeDto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    const employee = this.employeeRepository.create({
      ...createEmployeeDto,
      comment: createEmployeeDto.comment ?? null,
      hours: createEmployeeDto.hours.toFixed(2),
    })

    const savedEmployee = await this.employeeRepository.save(employee)

    return toEmployeeResponseDto(savedEmployee)
  }

  async findAll(): Promise<EmployeeResponseDto[]> {
    const employees = await this.employeeRepository.find({
      order: {
        id: 'DESC',
      },
    })

    return employees.map(toEmployeeResponseDto)
  }

  async findByEmployeeId(employeeId: string): Promise<EmployeeResponseDto[]> {
    const employees = await this.employeeRepository.find({
      where: {
        employeeId,
      },
      order: {
        id: 'DESC',
      },
    })

    return employees.map(toEmployeeResponseDto)
  }
}
