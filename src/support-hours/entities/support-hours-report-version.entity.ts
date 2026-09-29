import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

// These are issued documents, not live package relations. Removing a package
// must never cascade into the history of files already given to a client.
@Entity('support_hours_report_versions')
@Index('uq_support_report_versions_request', ['requestId'], { unique: true })
@Index('uq_support_report_versions_package_number', ['packageId', 'versionNumber'], { unique: true })
@Index('idx_support_report_versions_project_created', ['projectId', 'createdAt'])
export class SupportHoursReportVersion {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true }) id!: number
  @Column({ name: 'request_id', type: 'char', length: 36 }) requestId!: string
  @Column({ name: 'package_id', type: 'bigint', unsigned: true }) packageId!: number
  @Column({ name: 'project_id', type: 'bigint', unsigned: true }) projectId!: number
  @Column({ name: 'version_number', type: 'int', unsigned: true }) versionNumber!: number
  @Column({ name: 'project_title', type: 'varchar', length: 500 }) projectTitle!: string
  @Column({ name: 'client_name', type: 'varchar', length: 500, nullable: true }) clientName!: string | null
  @Column({ type: 'varchar', length: 150 }) filename!: string
  @Column({ name: 'storage_filename', type: 'char', length: 40 }) storageFilename!: string
  @Column({ name: 'byte_size', type: 'int', unsigned: true }) byteSize!: number
  @Column({ type: 'char', length: 64 }) sha256!: string
  @Column({ name: 'purchased_hours', type: 'decimal', precision: 10, scale: 2 }) purchasedHours!: number
  @Column({ name: 'spent_hours', type: 'decimal', precision: 10, scale: 2 }) spentHours!: number
  @Column({ name: 'remaining_hours', type: 'decimal', precision: 10, scale: 2 }) remainingHours!: number
  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 }) createdAt!: Date
}
