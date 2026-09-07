import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

const columns = [
  ['bitrix_company_id', 'varchar', '64'],
  ['company_name', 'varchar', '500'],
  ['project_title', 'varchar', '500'],
  ['bitrix_activity_id', 'varchar', '64'],
  ['activity_title', 'varchar', '500'],
] as const

export class AddReportContextToSupportHoursReports1789535600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('support_hours_reports'))) {
      return
    }

    for (const [name, type, length] of columns) {
      if (await queryRunner.hasColumn('support_hours_reports', name)) {
        continue
      }

      await queryRunner.addColumn(
        'support_hours_reports',
        new TableColumn({ name, type, length, isNullable: true }),
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('support_hours_reports'))) {
      return
    }

    for (const [name] of [...columns].reverse()) {
      if (await queryRunner.hasColumn('support_hours_reports', name)) {
        await queryRunner.dropColumn('support_hours_reports', name)
      }
    }
  }
}
