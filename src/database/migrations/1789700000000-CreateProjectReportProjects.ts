import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm'

export class CreateProjectReportProjects1789700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasProjectsTable = await queryRunner.hasTable('project_report_projects')

    if (hasProjectsTable) {
      return
    }

    await queryRunner.createTable(
      new Table({
        name: 'project_report_projects',
        columns: [
          {
            name: 'id',
            type: 'bigint',
            unsigned: true,
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'title',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'project_amount',
            type: 'double',
            isNullable: true,
          },
          {
            name: 'project_type',
            type: 'enum',
            enum: ['none', 'waterfall', 'support'],
            default: "'none'",
          },
          {
            name: 'project_goal',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'client_company',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'deal',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'next_report_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'report_info',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'deadline',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'redline',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'responsible',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'analyst',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'development_team',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'qa',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'tz_start_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'tz_weeks',
            type: 'double',
            isNullable: true,
          },
          {
            name: 'tz_plan_end_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'tz_fact_end_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'tz_sign_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'development_weeks',
            type: 'double',
            isNullable: true,
          },
          {
            name: 'development_plan_start_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'development_plan_end_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'development_fact_start_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'development_fact_end_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'education_weeks',
            type: 'double',
            isNullable: true,
          },
          {
            name: 'education_plan_start_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'education_plan_end_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'education_fact_start_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'education_fact_end_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'close_date',
            type: 'date',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    )

    await queryRunner.createIndex(
      'project_report_projects',
      new TableIndex({
        name: 'idx_project_report_projects_project_type',
        columnNames: ['project_type'],
      }),
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasProjectsTable = await queryRunner.hasTable('project_report_projects')

    if (hasProjectsTable) {
      await queryRunner.dropTable('project_report_projects', true)
    }
  }
}
