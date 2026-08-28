import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { ProjectGanttEvent } from './project-gantt-event.entity'
import { ProjectPayment } from './project-payment.entity'

export enum ProjectGanttStageType {
  Payments = 'payments',
  TzWriting = 'tz_writing',
  TzSigning = 'tz_signing',
  Contracting = 'contracting',
  Development = 'development',
  Education = 'education',
  Delivery = 'delivery',
  Closing = 'closing',
}

export enum ProjectGanttDependencyAnchor {
  StageStart = 'stage_start',
  StageEnd = 'stage_end',
}

export enum ProjectGanttGroupStatus {
  NotStarted = 'not_started',
  InProgress = 'in_progress',
  Inactive = 'inactive',
  Completed = 'completed',
}

@Entity('project_gantt_stages')
@Index('idx_project_gantt_stages_project_id', ['projectId'])
@Index('idx_project_gantt_stages_project_id_code', ['projectId', 'code'], {
  unique: true,
})
@Index('idx_project_gantt_stages_project_id_stage_type', [
  'projectId',
  'stageType',
])
@Index('idx_project_gantt_stages_parent_stage_id', ['parentStageId'])
export class ProjectGanttStage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'project_id', type: 'varchar', length: 64 })
  projectId!: string

  @Column({ type: 'varchar', length: 255 })
  title!: string

  @Column({ type: 'varchar', length: 64 })
  code!: string

  @Column({
    name: 'stage_type',
    type: 'enum',
    enum: ProjectGanttStageType,
    nullable: true,
  })
  stageType!: ProjectGanttStageType | null

  @Column({ name: 'depends_on_stage_id', type: 'bigint', unsigned: true, nullable: true })
  dependsOnStageId!: number | null

  @Column({
    name: 'dependency_anchor',
    type: 'enum',
    enum: ProjectGanttDependencyAnchor,
    nullable: true,
  })
  dependencyAnchor!: ProjectGanttDependencyAnchor | null

  @Column({ name: 'duration_days', type: 'int', unsigned: true, nullable: true })
  durationDays!: number | null

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean

  @Column({ name: 'is_group', type: 'boolean', default: false })
  isGroup!: boolean

  @Column({
    name: 'group_status',
    type: 'enum',
    enum: ProjectGanttGroupStatus,
    default: ProjectGanttGroupStatus.NotStarted,
  })
  groupStatus!: ProjectGanttGroupStatus

  @Column({ name: 'parent_stage_id', type: 'bigint', unsigned: true, nullable: true })
  parentStageId!: number | null

  @ManyToOne(() => ProjectGanttStage, (stage) => stage.children, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'parent_stage_id' })
  parentStage!: ProjectGanttStage | null

  @OneToMany(() => ProjectGanttStage, (stage) => stage.parentStage)
  children!: ProjectGanttStage[]

  @OneToMany(() => ProjectGanttEvent, (event) => event.stage)
  events!: ProjectGanttEvent[]

  @OneToMany(() => ProjectPayment, (payment) => payment.stage)
  payments!: ProjectPayment[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
