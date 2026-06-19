import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { GanttIncidentFile } from './gantt-incident-file.entity'

export enum GanttIncidentEntityType {
  BitrixStage = 'bitrix_stage',
  CustomEvent = 'custom_event',
  PaymentWaitingOverdue = 'payment_waiting_overdue',
}

@Entity('gantt_incidents')
@Index('idx_gantt_incidents_project_id', ['bitrixProjectId'])
@Index('idx_gantt_incidents_entity_type_entity_id', ['entityType', 'entityId'])
export class GanttIncident {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'bitrix_project_id', type: 'varchar', length: 64 })
  bitrixProjectId!: string

  @Column({ name: 'entity_type', type: 'enum', enum: GanttIncidentEntityType })
  entityType!: GanttIncidentEntityType

  @Column({ name: 'entity_id', type: 'varchar', length: 128 })
  entityId!: string

  @Column({ type: 'varchar', length: 255 })
  title!: string

  @Column({ type: 'text', nullable: true })
  description!: string | null

  @Column({ name: 'incident_date', type: 'date' })
  incidentDate!: string

  @OneToMany(() => GanttIncidentFile, (file) => file.incident)
  files!: GanttIncidentFile[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
