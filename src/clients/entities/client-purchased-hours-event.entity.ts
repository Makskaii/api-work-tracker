import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm'
import { Client } from './client.entity'

export enum ClientPurchasedHoursEventType {
  Added = 'added',
  Removed = 'removed',
}

@Entity('client_purchased_hours_events')
export class ClientPurchasedHoursEvent {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'client_id', type: 'bigint', unsigned: true })
  clientId!: number

  @ManyToOne(() => Client, (client) => client.purchasedHoursEvents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'client_id' })
  client!: Client

  @Column({
    type: 'enum',
    enum: ClientPurchasedHoursEventType,
  })
  type!: ClientPurchasedHoursEventType

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  hours!: number

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  amount!: number | null

  @Column({ name: 'balance_after', type: 'decimal', precision: 8, scale: 2 })
  balanceAfter!: number

  @Column({ type: 'date', nullable: true })
  date!: string | null

  @Column({ type: 'text', nullable: true })
  comment!: string | null

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt!: Date
}
