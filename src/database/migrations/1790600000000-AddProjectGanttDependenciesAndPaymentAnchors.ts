import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddProjectGanttDependenciesAndPaymentAnchors1790600000000
  implements MigrationInterface
{
  name = 'AddProjectGanttDependenciesAndPaymentAnchors1790600000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `project_gantt_stages` ADD `depends_on_stage_id` bigint UNSIGNED NULL',
    )
    await queryRunner.query(
      'ALTER TABLE `project_gantt_stages` ADD `duration_days` int UNSIGNED NULL',
    )
    await queryRunner.query(
      'CREATE INDEX `idx_project_gantt_stages_depends_on_stage_id` ON `project_gantt_stages` (`depends_on_stage_id`)',
    )
    await queryRunner.query(
      "ALTER TABLE `project_payments` ADD `payment_anchor` enum ('stage_start', 'stage_end') NOT NULL DEFAULT 'stage_end'",
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `project_payments` DROP COLUMN `payment_anchor`',
    )
    await queryRunner.query(
      'DROP INDEX `idx_project_gantt_stages_depends_on_stage_id` ON `project_gantt_stages`',
    )
    await queryRunner.query(
      'ALTER TABLE `project_gantt_stages` DROP COLUMN `duration_days`',
    )
    await queryRunner.query(
      'ALTER TABLE `project_gantt_stages` DROP COLUMN `depends_on_stage_id`',
    )
  }
}
