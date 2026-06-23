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

export enum ProjectGanttEventKind {
  OneTime = 'one_time',
  Duration = 'duration',
}

@Entity('project_gantt_events')
@Index('idx_project_gantt_events_project_id', ['projectId'])
@Index('idx_project_gantt_events_stage_id', ['stageId'])
export class ProjectGanttEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'project_id', type: 'varchar', length: 64 })
  projectId!: string

  @Column({ name: 'stage_id', type: 'bigint', unsigned: true })
  stageId!: number

  @ManyToOne(() => ProjectGanttStage, (stage) => stage.events, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'stage_id' })
  stage!: ProjectGanttStage

  @Column({ type: 'varchar', length: 255 })
  title!: string

  @Column({ name: 'event_kind', type: 'enum', enum: ProjectGanttEventKind })
  eventKind!: ProjectGanttEventKind

  @Column({ name: 'plan_start_date', type: 'date', nullable: true })
  planStartDate!: string | null

  @Column({ name: 'plan_end_date', type: 'date', nullable: true })
  planEndDate!: string | null

  @Column({ name: 'fact_start_date', type: 'date', nullable: true })
  factStartDate!: string | null

  @Column({ name: 'fact_end_date', type: 'date', nullable: true })
  factEndDate!: string | null

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
