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
import { ReportProject } from './project-report-project.entity'
import { ProjectReportEntryFile } from './project-report-entry-file.entity'

@Entity('project_report_entries')
@Index('idx_project_report_entries_project_id', ['projectId'])
export class ProjectReportEntry {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'project_id', type: 'bigint', unsigned: true })
  projectId!: number

  @ManyToOne(() => ReportProject, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: ReportProject

  @Column({ name: 'author_id', type: 'varchar', length: 128, nullable: true })
  authorId!: string | null

  @Column({ name: 'author_name', type: 'varchar', length: 255 })
  authorName!: string

  @Column({ type: 'text' })
  text!: string

  @Column({ name: 'report_date', type: 'date' })
  reportDate!: string

  @Column({ name: 'next_report_date', type: 'date', nullable: true })
  nextReportDate!: string | null

  @OneToMany(() => ProjectReportEntryFile, (file) => file.reportEntry)
  files!: ProjectReportEntryFile[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
