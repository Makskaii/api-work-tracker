import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddReportProjectStatus1791200000000 implements MigrationInterface {
  name = 'AddReportProjectStatus1791200000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `project_report_projects` ADD `project_status` enum ('not_started', 'in_progress', 'inactive', 'completed') NULL DEFAULT 'not_started'",
    )
    await queryRunner.query(
      "UPDATE `project_report_projects` SET `project_status` = 'not_started' WHERE `project_status` IS NULL",
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `project_report_projects` DROP COLUMN `project_status`',
    )
  }
}
