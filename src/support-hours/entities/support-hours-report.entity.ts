import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { ReportProject } from '../../project-reports/entities/project-report-project.entity'
import { SupportHoursConsumption } from './support-hours-consumption.entity'

@Entity('support_hours_reports')
@Index('uq_support_hours_reports_bitrix_report_id', ['bitrixReportId'], { unique: true })
@Index('idx_support_hours_reports_project_last_activity', ['projectId', 'lastActivityAt'])
export class SupportHoursReport {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id!: number
  @Column({ name: 'bitrix_report_id', type: 'varchar', length: 64 }) bitrixReportId!: string
  @Column({ name: 'project_id', type: 'bigint', unsigned: true }) projectId!: number
  @ManyToOne(() => ReportProject, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project!: ReportProject
  @Column({ type: 'decimal', precision: 10, scale: 2 }) hours!: number
  @Column({ name: 'report_date', type: 'datetime' }) reportDate!: Date
  @Column({ name: 'last_activity_at', type: 'datetime' }) lastActivityAt!: Date
  @Column({ name: 'report_title', type: 'varchar', length: 500, nullable: true }) reportTitle!: string | null
  @Column({ name: 'report_description', type: 'text', nullable: true }) reportDescription!: string | null
  @Column({ name: 'bitrix_task_id', type: 'varchar', length: 64, nullable: true }) bitrixTaskId!: string | null
  @Column({ name: 'task_title', type: 'varchar', length: 500, nullable: true }) taskTitle!: string | null
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date
  @OneToMany(() => SupportHoursConsumption, (consumption) => consumption.report) consumptions!: SupportHoursConsumption[]
}
