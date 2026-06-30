import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddSalesManagerAndContractingStage1790600000000
  implements MigrationInterface
{
  private readonly projectsTableName = 'project_report_projects'

  async up(queryRunner: QueryRunner): Promise<void> {
    const hasSalesManagerColumn = await queryRunner.hasColumn(
      this.projectsTableName,
      'sales_manager',
    )

    if (!hasSalesManagerColumn) {
      await queryRunner.addColumn(
        this.projectsTableName,
        new TableColumn({
          name: 'sales_manager',
          type: 'varchar',
          length: '255',
          isNullable: true,
        }),
      )
    }

    await queryRunner.query(
      "ALTER TABLE `project_gantt_stages` MODIFY `stage_type` enum('payments','tz_writing','tz_signing','contracting','development','education','delivery','closing') NULL",
    )
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "UPDATE `project_gantt_stages` SET `stage_type` = NULL WHERE `stage_type` = 'contracting'",
    )
    await queryRunner.query(
      "ALTER TABLE `project_gantt_stages` MODIFY `stage_type` enum('payments','tz_writing','tz_signing','development','education','delivery','closing') NULL",
    )

    const hasSalesManagerColumn = await queryRunner.hasColumn(
      this.projectsTableName,
      'sales_manager',
    )

    if (hasSalesManagerColumn) {
      await queryRunner.dropColumn(this.projectsTableName, 'sales_manager')
    }
  }
}
