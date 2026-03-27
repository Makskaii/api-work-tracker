import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('directory_statuses')
@Index(['statusId'], { unique: true })
export class DirectoryStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'bitrix_id', type: 'bigint', nullable: true })
  bitrixId: number | null

  @Column({ name: 'entity_id', type: 'varchar', length: 100, nullable: true })
  entityId: string | null

  @Column({ name: 'status_id', type: 'varchar', length: 100 })
  statusId: string

  @Column({ type: 'varchar', length: 255 })
  name: string

  @Column({ name: 'name_init', type: 'varchar', length: 255, nullable: true })
  nameInit: string | null

  @Column({ type: 'int', default: 500 })
  sort: number

  @Column({ type: 'varchar', length: 10, nullable: true })
  color: string | null

  @Column({ type: 'varchar', length: 50, nullable: true })
  semantics: string | null

  @Column({ name: 'category_id', type: 'varchar', length: 100, nullable: true })
  categoryId: string | null

  @Column({ type: 'boolean', default: false })
  system: boolean

  @Column({ type: 'boolean', default: true })
  isActive: boolean

  @Column({ type: 'json', nullable: true })
  // biome-ignore lint/suspicious/noExplicitAny: <ss>
  raw: Record<string, any> | null

  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt: Date | null

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
