import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Employee } from './entity/employee.entity'

@Injectable()
export class EmployeeService {
  constructor(
    @InjectRepository(Employee) private usersRepository: Repository<Employee>,
  ) {}

  findAll(): Promise<Employee[]> {
    return this.usersRepository.find()
  }
}
