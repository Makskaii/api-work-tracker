import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddProjectGanttStageGroups1791100000000 implements MigrationInterface {
  name = 'AddProjectGanttStageGroups1791100000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `project_gantt_stages` ADD `is_group` tinyint NOT NULL DEFAULT 0')
    await queryRunner.query("ALTER TABLE `project_gantt_stages` ADD `group_status` enum ('not_started', 'in_progress', 'inactive', 'completed') NOT NULL DEFAULT 'not_started'")
    await queryRunner.query('ALTER TABLE `project_gantt_stages` ADD `parent_stage_id` bigint UNSIGNED NULL')
    await queryRunner.query('CREATE INDEX `idx_project_gantt_stages_parent_stage_id` ON `project_gantt_stages` (`parent_stage_id`)')
    await queryRunner.query('ALTER TABLE `project_gantt_stages` ADD CONSTRAINT `FK_project_gantt_stages_parent_stage_id` FOREIGN KEY (`parent_stage_id`) REFERENCES `project_gantt_stages`(`id`) ON DELETE SET NULL')

    await queryRunner.startTransaction()
    try {
      await queryRunner.query("INSERT INTO `project_gantt_stages` (`project_id`, `title`, `code`, `stage_type`, `depends_on_stage_id`, `dependency_anchor`, `duration_days`, `sort_order`, `is_default`, `is_group`, `group_status`, `parent_stage_id`) SELECT `stage`.`project_id`, 'Нераспределённые этапы', CONCAT('unassigned-stages-', UUID()), NULL, NULL, NULL, NULL, 0, 0, 1, 'not_started', NULL FROM `project_gantt_stages` AS `stage` WHERE `stage`.`is_group` = 0 AND `stage`.`code` <> 'payments' AND NOT EXISTS (SELECT 1 FROM `project_gantt_stages` AS `group_stage` WHERE `group_stage`.`project_id` = `stage`.`project_id` AND `group_stage`.`is_group` = 1) GROUP BY `stage`.`project_id`")
      await queryRunner.query("UPDATE `project_gantt_stages` AS `child` INNER JOIN `project_gantt_stages` AS `parent` ON `parent`.`project_id` = `child`.`project_id` AND `parent`.`is_group` = 1 AND `parent`.`title` = 'Нераспределённые этапы' SET `child`.`parent_stage_id` = `parent`.`id` WHERE `child`.`is_group` = 0 AND `child`.`code` <> 'payments' AND `child`.`parent_stage_id` IS NULL")
      await queryRunner.commitTransaction()
    } catch (error) {
      await queryRunner.rollbackTransaction()
      throw error
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('UPDATE `project_gantt_stages` SET `parent_stage_id` = NULL WHERE `parent_stage_id` IS NOT NULL')
    await queryRunner.query("DELETE FROM `project_gantt_stages` WHERE `is_group` = 1 AND `title` = 'Нераспределённые этапы' AND `code` LIKE 'unassigned-stages-%'")
    await queryRunner.query('ALTER TABLE `project_gantt_stages` DROP FOREIGN KEY `FK_project_gantt_stages_parent_stage_id`')
    await queryRunner.query('DROP INDEX `idx_project_gantt_stages_parent_stage_id` ON `project_gantt_stages`')
    await queryRunner.query('ALTER TABLE `project_gantt_stages` DROP COLUMN `parent_stage_id`')
    await queryRunner.query('ALTER TABLE `project_gantt_stages` DROP COLUMN `group_status`')
    await queryRunner.query('ALTER TABLE `project_gantt_stages` DROP COLUMN `is_group`')
  }
}
