import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateSupportHoursAssignments1791500000000 implements MigrationInterface {
  name = 'CreateSupportHoursAssignments1791500000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`support_hours_assignments\` (
      \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
      \`project_id\` bigint UNSIGNED NOT NULL,
      \`bitrix_report_id\` varchar(64) NOT NULL,
      \`allocations\` json NOT NULL,
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      UNIQUE INDEX \`uq_support_hours_assignment_project_report\` (\`project_id\`, \`bitrix_report_id\`),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`fk_support_hours_assignment_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`project_report_projects\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
    await queryRunner.query(`CREATE TABLE \`support_task_assignments\` (
      \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
      \`project_id\` bigint UNSIGNED NOT NULL,
      \`bitrix_task_id\` varchar(64) NOT NULL,
      \`package_id\` bigint UNSIGNED NULL,
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      UNIQUE INDEX \`uq_support_task_assignment_project_task\` (\`project_id\`, \`bitrix_task_id\`),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`fk_support_task_assignment_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`project_report_projects\` (\`id\`) ON DELETE CASCADE,
      CONSTRAINT \`fk_support_task_assignment_package\` FOREIGN KEY (\`package_id\`) REFERENCES \`support_hours_packages\` (\`id\`) ON DELETE SET NULL
    ) ENGINE=InnoDB`)
    await queryRunner.query(`CREATE TABLE \`support_hours_transfers\` (
      \`id\` varchar(36) NOT NULL,
      \`project_id\` bigint UNSIGNED NOT NULL,
      \`actor_id\` bigint UNSIGNED NOT NULL,
      \`status\` varchar(16) NOT NULL,
      \`payload\` json NOT NULL,
      \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      INDEX \`idx_support_hours_transfer_project_status\` (\`project_id\`, \`status\`),
      PRIMARY KEY (\`id\`),
      CONSTRAINT \`fk_support_hours_transfer_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`project_report_projects\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `support_hours_transfers`')
    await queryRunner.query('DROP TABLE `support_task_assignments`')
    await queryRunner.query('DROP TABLE `support_hours_assignments`')
  }
}
