import { Reports } from 'src/types/reports'
import { type Tasks } from 'src/types/tasks'
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('employee')
export class Employee {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string

  @Column()
  timeSpent: number
}
