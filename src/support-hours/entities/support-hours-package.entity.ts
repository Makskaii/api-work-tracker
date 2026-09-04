import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import { ReportProject } from '../../project-reports/entities/project-report-project.entity'
import { SupportHoursConsumption } from './support-hours-consumption.entity'

@Entity('support_hours_packages')
@Index('idx_support_hours_packages_project_purchase_date', ['projectId', 'purchaseDate', 'id'])
export class SupportHoursPackage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id!: number
  @Column({ name: 'project_id', type: 'bigint', unsigned: true }) projectId!: number
  @ManyToOne(() => ReportProject, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project!: ReportProject
  @Column({ name: 'purchased_hours', type: 'decimal', precision: 10, scale: 2 }) purchasedHours!: number
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true }) amount!: number | null
  @Column({ name: 'purchase_date', type: 'date' }) purchaseDate!: string
  @Column({ type: 'text', nullable: true }) comment!: string | null
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date
  @OneToMany(() => SupportHoursConsumption, (consumption) => consumption.package) consumptions!: SupportHoursConsumption[]
}
