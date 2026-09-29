import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateSupportHoursReportVersions1791400000000 implements MigrationInterface {
  name = 'CreateSupportHoursReportVersions1791400000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`support_hours_report_versions\` (
      \`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT,
      \`request_id\` char(36) NOT NULL,
      \`package_id\` bigint UNSIGNED NOT NULL,
      \`project_id\` bigint UNSIGNED NOT NULL,
      \`version_number\` int UNSIGNED NOT NULL,
      \`project_title\` varchar(500) NOT NULL,
      \`client_name\` varchar(500) NULL,
      \`filename\` varchar(150) NOT NULL,
      \`storage_filename\` char(40) NOT NULL,
      \`byte_size\` int UNSIGNED NOT NULL,
      \`sha256\` char(64) NOT NULL,
      \`purchased_hours\` decimal(10,2) NOT NULL,
      \`spent_hours\` decimal(10,2) NOT NULL,
      \`remaining_hours\` decimal(10,2) NOT NULL,
      \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE INDEX \`uq_support_report_versions_request\` (\`request_id\`),
      UNIQUE INDEX \`uq_support_report_versions_package_number\` (\`package_id\`, \`version_number\`),
      INDEX \`idx_support_report_versions_project_created\` (\`project_id\`, \`created_at\`),
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB`)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `support_hours_report_versions`')
  }
}
