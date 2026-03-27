import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'

@Entity('directory_clients')
@Index(['listItemId'], { unique: true })
export class DirectoryClient {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ name: 'list_item_id', type: 'bigint' })
  listItemId: number

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
