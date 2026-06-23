import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { ReportProjectFile } from './report-project-file.entity'

export enum ReportProjectType {
  None = 'none',
  Waterfall = 'waterfall',
  Support = 'support',
}

@Entity('project_report_projects')
@Index('idx_project_report_projects_project_type', ['projectType'])
export class ReportProject {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ type: 'varchar', length: 255 })
  title!: string

  @Column({ name: 'project_amount', type: 'double', nullable: true })
  projectAmount!: number | null

  @Column({ name: 'project_type', type: 'enum', enum: ReportProjectType, default: ReportProjectType.None })
  projectType!: ReportProjectType

  @Column({ name: 'project_goal', type: 'text', nullable: true })
  projectGoal!: string | null

  @Column({ name: 'client_company', type: 'varchar', length: 255, nullable: true })
  clientCompany!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  deal!: string | null

  @Column({ name: 'next_report_date', type: 'date', nullable: true })
  nextReportDate!: string | null

  @Column({ name: 'report_info', type: 'text', nullable: true })
  reportInfo!: string | null

  @Column({ type: 'date', nullable: true })
  deadline!: string | null

  @Column({ type: 'date', nullable: true })
  redline!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  responsible!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  analyst!: string | null

  @Column({ name: 'development_team', type: 'text', nullable: true })
  developmentTeam!: string | null

  @Column({ type: 'varchar', length: 255, nullable: true })
  qa!: string | null

  @Column({ name: 'tz_start_date', type: 'date', nullable: true })
  tzStartDate!: string | null

  @Column({ name: 'tz_weeks', type: 'double', nullable: true })
  tzWeeks!: number | null

  @Column({ name: 'tz_plan_end_date', type: 'date', nullable: true })
  tzPlanEndDate!: string | null

  @Column({ name: 'tz_fact_end_date', type: 'date', nullable: true })
  tzFactEndDate!: string | null

  @Column({ name: 'tz_sign_date', type: 'date', nullable: true })
  tzSignDate!: string | null

  @Column({ name: 'development_weeks', type: 'double', nullable: true })
  developmentWeeks!: number | null

  @Column({ name: 'development_plan_start_date', type: 'date', nullable: true })
  developmentPlanStartDate!: string | null

  @Column({ name: 'development_plan_end_date', type: 'date', nullable: true })
  developmentPlanEndDate!: string | null

  @Column({ name: 'development_fact_start_date', type: 'date', nullable: true })
  developmentFactStartDate!: string | null

  @Column({ name: 'development_fact_end_date', type: 'date', nullable: true })
  developmentFactEndDate!: string | null

  @Column({ name: 'education_weeks', type: 'double', nullable: true })
  educationWeeks!: number | null

  @Column({ name: 'education_plan_start_date', type: 'date', nullable: true })
  educationPlanStartDate!: string | null

  @Column({ name: 'education_plan_end_date', type: 'date', nullable: true })
  educationPlanEndDate!: string | null

  @Column({ name: 'education_fact_start_date', type: 'date', nullable: true })
  educationFactStartDate!: string | null

  @Column({ name: 'education_fact_end_date', type: 'date', nullable: true })
  educationFactEndDate!: string | null

  @Column({ name: 'close_date', type: 'date', nullable: true })
  closeDate!: string | null

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date

  @OneToMany(() => ReportProjectFile, (file) => file.project)
  files!: ReportProjectFile[]
}
