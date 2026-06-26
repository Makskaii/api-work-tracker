import type { MigrationInterface, QueryRunner } from 'typeorm'
import { Table, TableForeignKey, TableIndex } from 'typeorm'

export class CreateProjectReportEntries1790000000000 implements MigrationInterface {
  name = 'CreateProjectReportEntries1790000000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'project_report_entries',
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
            type: 'bigint',
            unsigned: true,
          },
          {
            name: 'author_id',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'author_name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'text',
            type: 'text',
          },
          {
            name: 'report_date',
            type: 'date',
          },
          {
            name: 'next_report_date',
            type: 'date',
            isNullable: true,
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
      true,
    )

    await queryRunner.createTable(
      new Table({
        name: 'project_report_entry_files',
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
            name: 'report_entry_id',
            type: 'bigint',
            unsigned: true,
          },
          {
            name: 'original_name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'stored_name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'mime_type',
            type: 'varchar',
            length: '128',
          },
          {
            name: 'size',
            type: 'int',
            unsigned: true,
          },
          {
            name: 'path',
            type: 'varchar',
            length: '512',
          },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    )

    await queryRunner.createIndex(
      'project_report_entries',
      new TableIndex({
        name: 'idx_project_report_entries_project_id',
        columnNames: ['project_id'],
      }),
    )

    await queryRunner.createIndex(
      'project_report_entry_files',
      new TableIndex({
        name: 'idx_project_report_entry_files_report_entry_id',
        columnNames: ['report_entry_id'],
      }),
    )

    await queryRunner.createForeignKey(
      'project_report_entries',
      new TableForeignKey({
        name: 'fk_project_report_entries_project_id',
        columnNames: ['project_id'],
        referencedTableName: 'project_report_projects',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    )

    await queryRunner.createForeignKey(
      'project_report_entry_files',
      new TableForeignKey({
        name: 'fk_project_report_entry_files_report_entry_id',
        columnNames: ['report_entry_id'],
        referencedTableName: 'project_report_entries',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('project_report_entry_files', true, true, true)
    await queryRunner.dropTable('project_report_entries', true, true, true)
  }
}
