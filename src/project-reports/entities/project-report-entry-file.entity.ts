import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { ProjectReportEntry } from './project-report-entry.entity'

@Entity('project_report_entry_files')
@Index('idx_project_report_entry_files_report_entry_id', ['reportEntryId'])
export class ProjectReportEntryFile {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'report_entry_id', type: 'bigint', unsigned: true })
  reportEntryId!: number

  @ManyToOne(() => ProjectReportEntry, (reportEntry) => reportEntry.files, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'report_entry_id' })
  reportEntry!: ProjectReportEntry

  @Column({ name: 'original_name', type: 'varchar', length: 255 })
  originalName!: string

  @Column({ name: 'stored_name', type: 'varchar', length: 255 })
  storedName!: string

  @Column({ name: 'mime_type', type: 'varchar', length: 128 })
  mimeType!: string

  @Column({ type: 'int', unsigned: true })
  size!: number

  @Column({ type: 'varchar', length: 512 })
  path!: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date
}
