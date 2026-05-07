import { MigrationInterface, QueryRunner, Table } from 'typeorm'

export class CreateEmployeeTable1788781200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasEmployeeTable = await queryRunner.hasTable('employee')

    if (hasEmployeeTable) {
      return
    }

    await queryRunner.createTable(
      new Table({
        name: 'employee',
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
            name: 'employee_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'activity_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'activity_name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'client_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'client_name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'project_id',
            type: 'varchar',
            length: '64',
            isNullable: false,
          },
          {
            name: 'project_name',
            type: 'varchar',
            length: '255',
            isNullable: false,
          },
          {
            name: 'comment',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'hours',
            type: 'decimal',
            precision: 6,
            scale: 2,
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('employee', true)
  }
}
