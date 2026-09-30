import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddProjectGanttPlannedHours1791600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn('project_gantt_stages', new TableColumn({
      name: 'planned_hours', type: 'decimal', precision: 10, scale: 2, isNullable: true,
    }))
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('project_gantt_stages', 'planned_hours')
  }
}
