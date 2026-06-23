import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import { ProjectGanttEvent } from './project-gantt-event.entity'
import { ProjectPayment } from './project-payment.entity'

@Entity('project_gantt_stages')
@Index('idx_project_gantt_stages_project_id', ['projectId'])
@Index('idx_project_gantt_stages_project_id_code', ['projectId', 'code'], {
  unique: true,
})
export class ProjectGanttStage {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id!: number

  @Column({ name: 'project_id', type: 'varchar', length: 64 })
  projectId!: string

  @Column({ type: 'varchar', length: 255 })
  title!: string

  @Column({ type: 'varchar', length: 64 })
  code!: string

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean

  @OneToMany(() => ProjectGanttEvent, (event) => event.stage)
  events!: ProjectGanttEvent[]

  @OneToMany(() => ProjectPayment, (payment) => payment.stage)
  payments!: ProjectPayment[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date
}
