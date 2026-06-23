import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { ReportProject } from './project-report-project.entity'

export enum ReportProjectFileKind {
  Estimate = 'estimate',
  TechnicalSpecification = 'technical_specification',
}

@Entity('report_project_files')
@Index('idx_report_project_files_project_id', ['projectId'])
@Index('idx_report_project_files_project_kind', ['projectId', 'fileKind'])
export class ReportProjectFile {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'project_id', type: 'bigint', unsigned: true })
  projectId!: number

  @ManyToOne(() => ReportProject, (project) => project.files, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'project_id' })
  project!: ReportProject

  @Column({ name: 'file_kind', type: 'enum', enum: ReportProjectFileKind })
  fileKind!: ReportProjectFileKind

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
