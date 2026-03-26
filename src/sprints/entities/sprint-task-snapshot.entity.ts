import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('sprint_task_snapshots')
@Index(['sprintCode', 'taskId'], { unique: true })
@Index(['sprintCode'])
@Index(['employeeId'])
@Index(['projectId'])
export class SprintTaskSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ type: 'varchar', length: 50 })
  sprintCode: string
  // пример: 2026-03-17_2026-03-30

  @Column({ type: 'date' })
  sprintStartDate: string

  @Column({ type: 'date' })
  sprintEndDate: string

  @Column({ type: 'bigint' })
  taskId: number

  @Column({ type: 'varchar', length: 500 })
  title: string

  @Column({ type: 'text', nullable: true })
  description: string | null

  @Column({ type: 'bigint', nullable: true })
  employeeId: number | null
  // обычно assignedId / responsibleId

  @Column({ type: 'varchar', length: 255, nullable: true })
  employeeName: string | null

  @Column({ type: 'bigint', nullable: true })
  projectId: number | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  projectName: string | null

  @Column({ type: 'bigint', nullable: true })
  clientId: number | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  clientName: string | null

  @Column({ type: 'varchar', length: 100, nullable: true })
  stageId: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  stageName: string | null

  @Column({ type: 'boolean', default: false })
  isCompleted: boolean

  @Column({ type: 'boolean', default: false })
  isOverdue: boolean

  @Column({ type: 'boolean', default: false })
  addedDuringSprint: boolean

  @Column({ type: 'boolean', default: false })
  removedDuringSprint: boolean

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  estimatedHours: string

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  spentHours: string

  @Column({ type: 'json', nullable: true })
  sprintDateStart: string[] | null
  // массив дат старта спринтов, если задача тянется через несколько спринтов

  @Column({ type: 'timestamp', nullable: true })
  taskCreatedAt: Date | null

  @Column({ type: 'timestamp', nullable: true })
  taskUpdatedAt: Date | null

  @Column({ type: 'timestamp', nullable: true })
  movedAt: Date | null

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null

  @Column({ type: 'timestamp', nullable: true })
  lastSyncedAt: Date | null

  @Column({ type: 'json', nullable: true })
  // biome-ignore lint/suspicious/noExplicitAny: <just for a while>
  raw: Record<string, any> | null
  // сырой кусок битрикс-данных для дебага на старте

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date
}
