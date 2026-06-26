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
import { ProjectGanttStage } from './project-gantt-stage.entity'
import { ReportProject } from './project-report-project.entity'
import { ProjectReportEntryFile } from './project-report-entry-file.entity'

export enum ProjectReportEntrySource {
  ProjectReport = 'project_report',
  GanttIncident = 'gantt_incident',
}

@Entity('project_report_entries')
@Index('idx_project_report_entries_project_id', ['projectId'])
@Index('idx_project_report_entries_project_source', ['projectId', 'source'])
@Index('idx_project_report_entries_gantt_stage_id', ['ganttStageId'])
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

  @Column({
    type: 'enum',
    enum: ProjectReportEntrySource,
    default: ProjectReportEntrySource.ProjectReport,
  })
  source!: ProjectReportEntrySource

  @Column({ name: 'gantt_stage_id', type: 'bigint', unsigned: true, nullable: true })
  ganttStageId!: number | null

  @ManyToOne(() => ProjectGanttStage, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'gantt_stage_id' })
  ganttStage!: ProjectGanttStage | null

  @Column({ name: 'gantt_date', type: 'date', nullable: true })
  ganttDate!: string | null

  @OneToMany(() => ProjectReportEntryFile, (file) => file.reportEntry)
  files!: ProjectReportEntryFile[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
