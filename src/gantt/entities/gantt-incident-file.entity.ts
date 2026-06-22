import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { GanttIncident } from './gantt-incident.entity'

@Entity('gantt_incident_files')
@Index('idx_gantt_incident_files_incident_id', ['incidentId'])
export class GanttIncidentFile {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'incident_id', type: 'bigint', unsigned: true })
  incidentId!: number

  @ManyToOne(() => GanttIncident, (incident) => incident.files, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'incident_id' })
  incident!: GanttIncident

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName!: string

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType!: string

  @Column({ name: 'size_bytes', type: 'int', unsigned: true })
  sizeBytes!: number

  @Column({ name: 'storage_path', type: 'varchar', length: 512 })
  storagePath!: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date
}
