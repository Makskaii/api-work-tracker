import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

export enum GanttCustomEventKind {
  OneTime = 'one_time',
  Duration = 'duration',
}

@Entity('gantt_custom_events')
@Index('idx_gantt_custom_events_project_id', ['bitrixProjectId'])
export class GanttCustomEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'bitrix_project_id', type: 'varchar', length: 64 })
  bitrixProjectId!: string

  @Column({ type: 'varchar', length: 255 })
  title!: string

  @Column({ name: 'event_kind', type: 'enum', enum: GanttCustomEventKind })
  eventKind!: GanttCustomEventKind

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
