import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddReportProjectUserIds1790900000000
  implements MigrationInterface
{
  private readonly projectsTableName = 'project_report_projects'

  private readonly columns = [
    new TableColumn({
      name: 'responsible_id',
      type: 'varchar',
      length: '64',
      isNullable: true,
    }),
    new TableColumn({
      name: 'sales_manager_id',
      type: 'varchar',
      length: '64',
      isNullable: true,
    }),
    new TableColumn({
      name: 'analyst_id',
      type: 'varchar',
      length: '64',
      isNullable: true,
    }),
    new TableColumn({
      name: 'development_team_ids',
      type: 'text',
      isNullable: true,
    }),
    new TableColumn({
      name: 'qa_id',
      type: 'varchar',
      length: '64',
      isNullable: true,
    }),
  ]

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
