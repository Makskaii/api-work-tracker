import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddProjectGanttDependencyAnchor1790700000000
  implements MigrationInterface
{
  name = 'AddProjectGanttDependencyAnchor1790700000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `project_gantt_stages` ADD `dependency_anchor` enum ('stage_start', 'stage_end') NULL",
    )
    await queryRunner.query(
      "UPDATE `project_gantt_stages` SET `dependency_anchor` = 'stage_end' WHERE `depends_on_stage_id` IS NOT NULL AND `dependency_anchor` IS NULL",
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `project_gantt_stages` DROP COLUMN `dependency_anchor`',
    )
  }
}
