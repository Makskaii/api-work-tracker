import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('directory_projects')
@Index(['listItemId'], { unique: true })
@Index(['sourceProjectId'], { unique: true })
export class DirectoryProject {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'list_item_id', type: 'bigint' })
  listItemId: number
  // ID из универсального списка

  @Column({ name: 'sourceProjectId', type: 'bigint', nullable: true })
  sourceProjectId: number | null
  // реальный ID проекта из PROPERTY_87

  @Column({ type: 'varchar', length: 255 })
  name: string

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
