import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm'

export class CreateProjectGanttStagesEventsAndPayments1789600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasStagesTable = await queryRunner.hasTable('project_gantt_stages')

    if (!hasStagesTable) {
      await queryRunner.createTable(
        new Table({
          name: 'project_gantt_stages',
          columns: [
            {
              name: 'id',
              type: 'bigint',
              unsigned: true,
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            {
              name: 'project_id',
              type: 'varchar',
              length: '64',
            },
            {
              name: 'title',
              type: 'varchar',
              length: '255',
            },
            {
              name: 'code',
              type: 'varchar',
              length: '64',
            },
            {
              name: 'sort_order',
              type: 'int',
              default: 0,
            },
            {
              name: 'is_default',
              type: 'boolean',
              default: false,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updated_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      )

      await queryRunner.createIndex(
        'project_gantt_stages',
        new TableIndex({
          name: 'idx_project_gantt_stages_project_id',
          columnNames: ['project_id'],
        }),
      )
      await queryRunner.createIndex(
        'project_gantt_stages',
        new TableIndex({
          name: 'idx_project_gantt_stages_project_id_code',
          columnNames: ['project_id', 'code'],
          isUnique: true,
        }),
      )
    }

    const hasEventsTable = await queryRunner.hasTable('project_gantt_events')

    if (!hasEventsTable) {
      await queryRunner.createTable(
        new Table({
          name: 'project_gantt_events',
          columns: [
            {
              name: 'id',
              type: 'bigint',
              unsigned: true,
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            {
              name: 'project_id',
              type: 'varchar',
              length: '64',
            },
            {
              name: 'stage_id',
              type: 'bigint',
              unsigned: true,
            },
            {
              name: 'title',
              type: 'varchar',
              length: '255',
            },
            {
              name: 'event_kind',
              type: 'enum',
              enum: ['one_time', 'duration'],
            },
            {
              name: 'plan_start_date',
              type: 'date',
              isNullable: true,
            },
            {
              name: 'plan_end_date',
              type: 'date',
              isNullable: true,
            },
            {
              name: 'fact_start_date',
              type: 'date',
              isNullable: true,
            },
            {
              name: 'fact_end_date',
              type: 'date',
              isNullable: true,
            },
            {
              name: 'sort_order',
              type: 'int',
              default: 0,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updated_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      )

      await queryRunner.createIndex(
        'project_gantt_events',
        new TableIndex({
          name: 'idx_project_gantt_events_project_id',
          columnNames: ['project_id'],
        }),
      )
      await queryRunner.createIndex(
        'project_gantt_events',
        new TableIndex({
          name: 'idx_project_gantt_events_stage_id',
          columnNames: ['stage_id'],
        }),
      )
      await queryRunner.createForeignKey(
        'project_gantt_events',
        new TableForeignKey({
          name: 'fk_project_gantt_events_stage_id',
          columnNames: ['stage_id'],
          referencedTableName: 'project_gantt_stages',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      )
    }

    const hasPaymentsTable = await queryRunner.hasTable('project_payments')

    if (!hasPaymentsTable) {
      await queryRunner.createTable(
        new Table({
          name: 'project_payments',
          columns: [
            {
              name: 'id',
              type: 'bigint',
              unsigned: true,
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            {
              name: 'project_id',
              type: 'varchar',
              length: '64',
            },
            {
              name: 'stage_id',
              type: 'bigint',
              unsigned: true,
            },
            {
              name: 'status',
              type: 'enum',
              enum: ['todo', 'debt', 'paid', 'canceled'],
            },
            {
              name: 'payment_date',
              type: 'date',
              isNullable: true,
            },
            {
              name: 'percent',
              type: 'double',
              isNullable: true,
            },
            {
              name: 'amount',
              type: 'double',
              isNullable: true,
            },
            {
              name: 'waiting_days',
              type: 'int',
              unsigned: true,
              isNullable: true,
            },
            {
              name: 'sort_order',
              type: 'int',
              default: 0,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
            },
            {
              name: 'updated_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
            },
          ],
        }),
      )

      await queryRunner.createIndex(
        'project_payments',
        new TableIndex({
          name: 'idx_project_payments_project_id',
          columnNames: ['project_id'],
        }),
      )
      await queryRunner.createIndex(
        'project_payments',
        new TableIndex({
          name: 'idx_project_payments_stage_id',
          columnNames: ['stage_id'],
        }),
      )
      await queryRunner.createIndex(
        'project_payments',
        new TableIndex({
          name: 'idx_project_payments_status',
          columnNames: ['status'],
        }),
      )
      await queryRunner.createForeignKey(
        'project_payments',
        new TableForeignKey({
          name: 'fk_project_payments_stage_id',
          columnNames: ['stage_id'],
          referencedTableName: 'project_gantt_stages',
          referencedColumnNames: ['id'],
          onDelete: 'RESTRICT',
        }),
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasPaymentsTable = await queryRunner.hasTable('project_payments')

    if (hasPaymentsTable) {
      await queryRunner.dropTable('project_payments', true)
    }

    const hasEventsTable = await queryRunner.hasTable('project_gantt_events')

    if (hasEventsTable) {
      await queryRunner.dropTable('project_gantt_events', true)
    }

    const hasStagesTable = await queryRunner.hasTable('project_gantt_stages')

    if (hasStagesTable) {
      await queryRunner.dropTable('project_gantt_stages', true)
    }
  }
}
