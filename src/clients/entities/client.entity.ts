import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm'

export enum ClientStatus {
  Active = 'active',
  Inactive = 'inactive',
}

@Entity('clients')
@Unique(['crmClientId'])
export class Client {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ type: 'varchar', length: 255 })
  name!: string

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string

  @Column({ name: 'crm_client_id', type: 'bigint' })
  crmClientId!: number

  @Column({
    type: 'enum',
    enum: ClientStatus,
    default: ClientStatus.Active,
  })
  status!: ClientStatus

  @Column({ name: 'last_login', type: 'datetime', nullable: true })
  lastLogin!: Date | null

  @CreateDateColumn({
    name: 'created_at',
  })
  createdAt!: Date

  @UpdateDateColumn({
    name: 'updated_at',
  })
  updatedAt!: Date
}
