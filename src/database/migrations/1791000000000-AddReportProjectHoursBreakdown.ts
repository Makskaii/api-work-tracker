import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddReportProjectHoursBreakdown1791000000000
  implements MigrationInterface
{
  private readonly projectsTableName = 'project_report_projects'

  private readonly columns = [
    'tz_purchased_hours',
    'tz_plan_hours',
    'tz_fact_hours',
    'development_purchased_hours',
    'education_purchased_hours',
    'education_plan_hours',
    'education_fact_hours',
  ].map(
    (name) =>
      new TableColumn({
        name,
        type: 'double',
        isNullable: true,
      }),
  )

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      const hasColumn = await queryRunner.hasColumn(
        this.projectsTableName,
        column.name,
      )

      if (!hasColumn) {
        await queryRunner.addColumn(this.projectsTableName, column)
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [...this.columns].reverse()) {
      const hasColumn = await queryRunner.hasColumn(
        this.projectsTableName,
        column.name,
      )

      if (hasColumn) {
        await queryRunner.dropColumn(this.projectsTableName, column.name)
      }
    }
  }
}
