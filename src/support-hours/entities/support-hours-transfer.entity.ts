import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm'
import { ReportProject } from '../../project-reports/entities/project-report-project.entity'

@Entity('support_hours_transfers')
@Index('idx_support_hours_transfer_project_status', ['projectId', 'status'])
export class SupportHoursTransfer {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id!: string
  @Column({ name: 'project_id', type: 'bigint', unsigned: true }) projectId!: number
  @ManyToOne(() => ReportProject, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project!: ReportProject
  @Column({ name: 'actor_id', type: 'bigint', unsigned: true }) actorId!: number
  @Column({ type: 'varchar', length: 16 }) status!: 'pending' | 'complete'
  @Column({ type: 'json' }) payload!: Record<string, unknown>
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 }) createdAt!: Date
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 }) updatedAt!: Date
}
