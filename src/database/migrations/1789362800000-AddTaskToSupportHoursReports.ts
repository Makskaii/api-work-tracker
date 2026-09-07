import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddTaskToSupportHoursReports1789362800000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasReportsTable = await queryRunner.hasTable('support_hours_reports')

    if (!hasReportsTable) {
      return
    }

    if (!(await queryRunner.hasColumn('support_hours_reports', 'bitrix_task_id'))) {
      await queryRunner.addColumn(
        'support_hours_reports',
        new TableColumn({
          name: 'bitrix_task_id',
          type: 'varchar',
          length: '64',
          isNullable: true,
        }),
      )
    }

    if (!(await queryRunner.hasColumn('support_hours_reports', 'task_title'))) {
      await queryRunner.addColumn(
        'support_hours_reports',
        new TableColumn({
          name: 'task_title',
          type: 'varchar',
          length: '500',
          isNullable: true,
        }),
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('support_hours_reports'))) {
      return
    }

    if (await queryRunner.hasColumn('support_hours_reports', 'task_title')) {
      await queryRunner.dropColumn('support_hours_reports', 'task_title')
    }

    if (await queryRunner.hasColumn('support_hours_reports', 'bitrix_task_id')) {
      await queryRunner.dropColumn('support_hours_reports', 'bitrix_task_id')
    }
  }
}
