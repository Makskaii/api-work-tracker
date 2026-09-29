import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { ReportProject } from '../../project-reports/entities/project-report-project.entity'
import { SupportHoursPackage } from './support-hours-package.entity'

@Entity('support_task_assignments')
@Index('uq_support_task_assignment_project_task', ['projectId', 'bitrixTaskId'], { unique: true })
export class SupportTaskAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id!: number
  @Column({ name: 'project_id', type: 'bigint', unsigned: true }) projectId!: number
  @ManyToOne(() => ReportProject, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project!: ReportProject
  @Column({ name: 'bitrix_task_id', type: 'varchar', length: 64 }) bitrixTaskId!: string
  // Null is an explicit unallocated destination, not a return to automatic FIFO.
  @Column({ name: 'package_id', type: 'bigint', unsigned: true, nullable: true }) packageId!: number | null
  @ManyToOne(() => SupportHoursPackage, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'package_id' }) package!: SupportHoursPackage | null
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 }) updatedAt!: Date
}
