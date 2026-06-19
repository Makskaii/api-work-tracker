import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm'

export class CreateGanttCustomEventsAndIncidents1789500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasCustomEventsTable = await queryRunner.hasTable(
      'gantt_custom_events',
    )

    if (!hasCustomEventsTable) {
      await queryRunner.createTable(
        new Table({
          name: 'gantt_custom_events',
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
              name: 'bitrix_project_id',
              type: 'varchar',
              length: '64',
              isNullable: false,
            },
            {
              name: 'title',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'event_kind',
              type: 'enum',
              enum: ['one_time', 'duration'],
              isNullable: false,
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
              isNullable: false,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
            {
              name: 'updated_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
          ],
        }),
      )

      await queryRunner.createIndex(
        'gantt_custom_events',
        new TableIndex({
          name: 'idx_gantt_custom_events_project_id',
          columnNames: ['bitrix_project_id'],
        }),
      )
    }

    const hasIncidentsTable = await queryRunner.hasTable('gantt_incidents')

    if (!hasIncidentsTable) {
      await queryRunner.createTable(
        new Table({
          name: 'gantt_incidents',
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
              name: 'bitrix_project_id',
              type: 'varchar',
              length: '64',
              isNullable: false,
            },
            {
              name: 'entity_type',
              type: 'enum',
              enum: ['bitrix_stage', 'custom_event', 'payment_waiting_overdue'],
              isNullable: false,
            },
            {
              name: 'entity_id',
              type: 'varchar',
              length: '128',
              isNullable: false,
            },
            {
              name: 'title',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'description',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'incident_date',
              type: 'date',
              isNullable: false,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
            {
              name: 'updated_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
          ],
        }),
      )

      await queryRunner.createIndex(
        'gantt_incidents',
        new TableIndex({
          name: 'idx_gantt_incidents_project_id',
          columnNames: ['bitrix_project_id'],
        }),
      )
      await queryRunner.createIndex(
        'gantt_incidents',
        new TableIndex({
          name: 'idx_gantt_incidents_entity_type_entity_id',
          columnNames: ['entity_type', 'entity_id'],
        }),
      )
    }

    const hasIncidentFilesTable = await queryRunner.hasTable(
      'gantt_incident_files',
    )

    if (!hasIncidentFilesTable) {
      await queryRunner.createTable(
        new Table({
          name: 'gantt_incident_files',
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
              name: 'incident_id',
              type: 'bigint',
              unsigned: true,
              isNullable: false,
            },
            {
              name: 'original_name',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'mime_type',
              type: 'varchar',
              length: '128',
              isNullable: false,
            },
            {
              name: 'size_bytes',
              type: 'int',
              unsigned: true,
              isNullable: false,
            },
            {
              name: 'storage_path',
              type: 'varchar',
              length: '512',
              isNullable: false,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
          ],
        }),
      )

      await queryRunner.createIndex(
        'gantt_incident_files',
        new TableIndex({
          name: 'idx_gantt_incident_files_incident_id',
          columnNames: ['incident_id'],
        }),
      )
      await queryRunner.createForeignKey(
        'gantt_incident_files',
        new TableForeignKey({
          columnNames: ['incident_id'],
          referencedTableName: 'gantt_incidents',
          referencedColumnNames: ['id'],
          onDelete: 'CASCADE',
        }),
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasIncidentFilesTable = await queryRunner.hasTable(
      'gantt_incident_files',
    )

    if (hasIncidentFilesTable) {
      await queryRunner.dropTable('gantt_incident_files', true)
    }

    const hasIncidentsTable = await queryRunner.hasTable('gantt_incidents')

    if (hasIncidentsTable) {
      await queryRunner.dropTable('gantt_incidents', true)
    }

    const hasCustomEventsTable = await queryRunner.hasTable(
      'gantt_custom_events',
    )

    if (hasCustomEventsTable) {
      await queryRunner.dropTable('gantt_custom_events', true)
    }
  }
}
