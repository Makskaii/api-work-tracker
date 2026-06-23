import type { MigrationInterface, QueryRunner } from 'typeorm'
import { Table, TableForeignKey, TableIndex } from 'typeorm'

export class CreateReportProjectFiles1789800000000 implements MigrationInterface {
  name = 'CreateReportProjectFiles1789800000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'report_project_files',
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
            name: 'file_kind',
            type: 'enum',
            enum: ['estimate', 'technical_specification'],
          },
          {
            name: 'original_name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'mime_type',
            type: 'varchar',
            length: '128',
          },
          {
            name: 'size_bytes',
            type: 'int',
            unsigned: true,
          },
          {
            name: 'storage_path',
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
      'report_project_files',
      new TableIndex({
        name: 'idx_report_project_files_project_id',
        columnNames: ['project_id'],
      }),
    )

    await queryRunner.createIndex(
      'report_project_files',
      new TableIndex({
        name: 'idx_report_project_files_project_kind',
        columnNames: ['project_id', 'file_kind'],
      }),
    )

    await queryRunner.createForeignKey(
      'report_project_files',
      new TableForeignKey({
        name: 'fk_report_project_files_project_id',
        columnNames: ['project_id'],
        referencedTableName: 'project_report_projects',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('report_project_files', true, true, true)
  }
}
