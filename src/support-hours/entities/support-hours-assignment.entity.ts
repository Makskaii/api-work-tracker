import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { ReportProject } from '../../project-reports/entities/project-report-project.entity'

// Deliberately not linked to the eligible-report cache: clearing the Bitrix
// checkbox must not discard an analyst's explicit allocation decision.
@Entity('support_hours_assignments')
@Index('uq_support_hours_assignment_project_report', ['projectId', 'bitrixReportId'], { unique: true })
export class SupportHoursAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id!: number
  @Column({ name: 'project_id', type: 'bigint', unsigned: true }) projectId!: number
  @ManyToOne(() => ReportProject, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project!: ReportProject
  @Column({ name: 'bitrix_report_id', type: 'varchar', length: 64 }) bitrixReportId!: string
  // An existing row with [] explicitly leaves the whole report unallocated.
  @Column({ type: 'json' }) allocations!: { packageId: number; hours: number }[]
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 }) updatedAt!: Date
}
