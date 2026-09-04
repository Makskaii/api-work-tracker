import { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateSupportHoursPackages1791300000000 implements MigrationInterface {
  name = 'CreateSupportHoursPackages1791300000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE TABLE `support_hours_packages` (`id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, `project_id` bigint UNSIGNED NOT NULL, `purchased_hours` decimal(10,2) NOT NULL, `amount` decimal(12,2) NULL, `purchase_date` date NOT NULL, `comment` text NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX `idx_support_hours_packages_project_purchase_date` (`project_id`, `purchase_date`, `id`), PRIMARY KEY (`id`)) ENGINE=InnoDB')
    await queryRunner.query('CREATE TABLE `support_hours_reports` (`id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, `bitrix_report_id` varchar(64) NOT NULL, `project_id` bigint UNSIGNED NOT NULL, `hours` decimal(10,2) NOT NULL, `report_date` datetime NOT NULL, `last_activity_at` datetime NOT NULL, `report_title` varchar(500) NULL, `report_description` text NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX `uq_support_hours_reports_bitrix_report_id` (`bitrix_report_id`), INDEX `idx_support_hours_reports_project_last_activity` (`project_id`, `last_activity_at`), PRIMARY KEY (`id`)) ENGINE=InnoDB')
    await queryRunner.query('CREATE TABLE `support_hours_consumptions` (`id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, `report_id` bigint UNSIGNED NOT NULL, `package_id` bigint UNSIGNED NOT NULL, `hours` decimal(10,2) NOT NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX `uq_support_hours_consumptions_report_package` (`report_id`, `package_id`), PRIMARY KEY (`id`)) ENGINE=InnoDB')
    await queryRunner.query('ALTER TABLE `support_hours_packages` ADD CONSTRAINT `fk_support_hours_packages_project` FOREIGN KEY (`project_id`) REFERENCES `project_report_projects`(`id`) ON DELETE CASCADE')
    await queryRunner.query('ALTER TABLE `support_hours_reports` ADD CONSTRAINT `fk_support_hours_reports_project` FOREIGN KEY (`project_id`) REFERENCES `project_report_projects`(`id`) ON DELETE CASCADE')
    await queryRunner.query('ALTER TABLE `support_hours_consumptions` ADD CONSTRAINT `fk_support_hours_consumptions_report` FOREIGN KEY (`report_id`) REFERENCES `support_hours_reports`(`id`) ON DELETE CASCADE')
    await queryRunner.query('ALTER TABLE `support_hours_consumptions` ADD CONSTRAINT `fk_support_hours_consumptions_package` FOREIGN KEY (`package_id`) REFERENCES `support_hours_packages`(`id`) ON DELETE CASCADE')
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `support_hours_consumptions`')
    await queryRunner.query('DROP TABLE `support_hours_reports`')
    await queryRunner.query('DROP TABLE `support_hours_packages`')
  }
}
