import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddReportProjectNextReportDate1790500000000
  implements MigrationInterface
{
  name = 'AddReportProjectNextReportDate1790500000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `project_report_projects` ADD `next_project_report_date` date NULL',
    )
    await queryRunner.query(`
      UPDATE \`project_report_projects\` project
      LEFT JOIN (
        SELECT
          report_entry.project_id,
          COALESCE(
            MIN(CASE WHEN report_entry.next_report_date >= CURDATE() THEN report_entry.next_report_date END),
            MAX(CASE WHEN report_entry.next_report_date < CURDATE() THEN report_entry.next_report_date END)
          ) AS next_project_report_date
        FROM \`project_report_entries\` report_entry
        WHERE report_entry.next_report_date IS NOT NULL
        GROUP BY report_entry.project_id
      ) report_dates ON report_dates.project_id = project.id
      SET project.next_project_report_date = report_dates.next_project_report_date
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `project_report_projects` DROP COLUMN `next_project_report_date`',
    )
  }
}
