import { type MigrationInterface, type QueryRunner, Table } from 'typeorm'

/** Separate from project attempts: a rejected project must retain its created company. */
export class AddReportProjectCompanyCreationRequests1791800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'project_report_company_creation_requests',
      columns: [
        { name: 'request_id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'project_title', type: 'varchar', length: '255' },
        { name: 'company_title', type: 'varchar', length: '255' },
        { name: 'company_id', type: 'varchar', length: '64', isNullable: true },
        { name: 'attempted_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
    }))
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // CRM companies and the existing project journals are deliberately retained.
    await queryRunner.dropTable('project_report_company_creation_requests')
  }
}
