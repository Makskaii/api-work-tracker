import { type MigrationInterface, type QueryRunner, Table, TableColumn, TableIndex } from 'typeorm'

export class AddReportProjectCompanyAndCreationRequest1791700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('project_report_projects', [
      new TableColumn({ name: 'client_company_id', type: 'varchar', length: '64', isNullable: true }),
      new TableColumn({ name: 'creation_request_id', type: 'varchar', length: '36', isNullable: true }),
    ])
    await queryRunner.createIndex('project_report_projects', new TableIndex({
      name: 'uq_project_report_projects_creation_request', columnNames: ['creation_request_id'], isUnique: true,
    }))
    await queryRunner.createTable(new Table({
      name: 'project_report_creation_requests',
      columns: [
        { name: 'request_id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'project_title', type: 'varchar', length: '255' },
        { name: 'company_id', type: 'varchar', length: '64' },
        { name: 'attempted_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
    }))
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('project_report_creation_requests')
    await queryRunner.dropIndex('project_report_projects', 'uq_project_report_projects_creation_request')
    await queryRunner.dropColumn('project_report_projects', 'creation_request_id')
    await queryRunner.dropColumn('project_report_projects', 'client_company_id')
  }
}
