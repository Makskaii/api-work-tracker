import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('employee')
export class Employee {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'employee_id', type: 'varchar', length: 64 })
  employeeId!: string

  @Column({ name: 'activity_id', type: 'varchar', length: 64 })
  activityId!: string

  @Column({ name: 'activity_name', type: 'varchar', length: 255 })
  activityName!: string

  @Column({ name: 'client_id', type: 'varchar', length: 64 })
  clientId!: string

  @Column({ name: 'client_name', type: 'varchar', length: 255 })
  clientName!: string

  @Column({ name: 'project_id', type: 'varchar', length: 64 })
  projectId!: string

  @Column({ name: 'project_name', type: 'varchar', length: 255 })
  projectName!: string

  @Column({ type: 'text', nullable: true })
  comment!: string | null

  @Column({ type: 'decimal', precision: 6, scale: 2 })
  hours!: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
