import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddProjectReportSummaryFields1790100000000
  implements MigrationInterface
{
  private readonly tableName = 'project_report_projects'

  private readonly columns = [
    new TableColumn({
      name: 'summary_margin_percent',
      type: 'double',
      isNullable: true,
    }),
    new TableColumn({
      name: 'summary_purchased_hours',
      type: 'double',
      isNullable: true,
    }),
    new TableColumn({
      name: 'summary_plan_hours',
      type: 'double',
      isNullable: true,
    }),
    new TableColumn({
      name: 'summary_fact_hours',
      type: 'double',
      isNullable: true,
    }),
    new TableColumn({
      name: 'summary_loss_hours',
      type: 'double',
      isNullable: true,
    }),
    new TableColumn({
      name: 'summary_plan_completion_date',
      type: 'date',
      isNullable: true,
    }),
    new TableColumn({
      name: 'summary_fact_completion_date',
      type: 'date',
      isNullable: true,
    }),
  ]

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      const hasColumn = await queryRunner.hasColumn(this.tableName, column.name)

      if (!hasColumn) {
        await queryRunner.addColumn(this.tableName, column)
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [...this.columns].reverse()) {
      const hasColumn = await queryRunner.hasColumn(this.tableName, column.name)

      if (hasColumn) {
        await queryRunner.dropColumn(this.tableName, column.name)
      }
    }
  }
}
