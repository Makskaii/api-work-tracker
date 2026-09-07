import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddResponsibleToSupportHoursReports1789449200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('support_hours_reports'))) {
      return
    }

    if (!(await queryRunner.hasColumn('support_hours_reports', 'bitrix_responsible_id'))) {
      await queryRunner.addColumn(
        'support_hours_reports',
        new TableColumn({
          name: 'bitrix_responsible_id',
          type: 'varchar',
          length: '64',
          isNullable: true,
        }),
      )
    }

    if (!(await queryRunner.hasColumn('support_hours_reports', 'responsible_name'))) {
      await queryRunner.addColumn(
        'support_hours_reports',
        new TableColumn({
          name: 'responsible_name',
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

    if (await queryRunner.hasColumn('support_hours_reports', 'responsible_name')) {
      await queryRunner.dropColumn('support_hours_reports', 'responsible_name')
    }

    if (await queryRunner.hasColumn('support_hours_reports', 'bitrix_responsible_id')) {
      await queryRunner.dropColumn('support_hours_reports', 'bitrix_responsible_id')
    }
  }
}
