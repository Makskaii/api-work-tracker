import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { ProjectGanttStage } from './project-gantt-stage.entity'

export enum ProjectPaymentStatus {
  Todo = 'todo',
  Debt = 'debt',
  Paid = 'paid',
  Canceled = 'canceled',
}

@Entity('project_payments')
@Index('idx_project_payments_project_id', ['projectId'])
@Index('idx_project_payments_stage_id', ['stageId'])
@Index('idx_project_payments_status', ['status'])
export class ProjectPayment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'project_id', type: 'varchar', length: 64 })
  projectId!: string

  @Column({ name: 'stage_id', type: 'bigint', unsigned: true })
  stageId!: number

  @ManyToOne(() => ProjectGanttStage, (stage) => stage.payments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'stage_id' })
  stage!: ProjectGanttStage

  @Column({ type: 'enum', enum: ProjectPaymentStatus })
  status!: ProjectPaymentStatus

  @Column({ name: 'payment_date', type: 'date', nullable: true })
  paymentDate!: string | null

  @Column({ type: 'double', nullable: true })
  percent!: number | null

  @Column({ type: 'double', nullable: true })
  amount!: number | null

  @Column({ name: 'waiting_days', type: 'int', unsigned: true, nullable: true })
  waitingDays!: number | null

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
