import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddReportProjectContractDates1790300000000
  implements MigrationInterface
{
  name = 'AddReportProjectContractDates1790300000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`project_report_projects\`
      ADD \`project_start_date\` date NULL,
      ADD \`contract_end_date\` date NULL
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`project_report_projects\`
      DROP COLUMN \`contract_end_date\`,
      DROP COLUMN \`project_start_date\`
    `)
  }
}
