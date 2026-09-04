import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm'
import { SupportHoursPackage } from './support-hours-package.entity'
import { SupportHoursReport } from './support-hours-report.entity'

@Entity('support_hours_consumptions')
@Index('uq_support_hours_consumptions_report_package', ['reportId', 'packageId'], { unique: true })
export class SupportHoursConsumption {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id!: number
  @Column({ name: 'report_id', type: 'bigint', unsigned: true }) reportId!: number
  @ManyToOne(() => SupportHoursReport, (report) => report.consumptions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'report_id' }) report!: SupportHoursReport
  @Column({ name: 'package_id', type: 'bigint', unsigned: true }) packageId!: number
  @ManyToOne(() => SupportHoursPackage, (item) => item.consumptions, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'package_id' }) package!: SupportHoursPackage
  @Column({ type: 'decimal', precision: 10, scale: 2 }) hours!: number
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date
}
