import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddReportProjectBitrixProjectId1790400000000
  implements MigrationInterface
{
  name = 'AddReportProjectBitrixProjectId1790400000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`project_report_projects\`
      ADD \`bitrix_project_id\` varchar(64) NULL
    `)
    await queryRunner.query(`
      CREATE INDEX \`idx_project_report_projects_bitrix_project_id\`
      ON \`project_report_projects\` (\`bitrix_project_id\`)
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX \`idx_project_report_projects_bitrix_project_id\`
      ON \`project_report_projects\`
    `)
    await queryRunner.query(`
      ALTER TABLE \`project_report_projects\`
      DROP COLUMN \`bitrix_project_id\`
    `)
  }
}
