import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableForeignKey,
  TableIndex,
} from 'typeorm'

export class AddProjectGanttStageTypesAndReportEntryGanttFields1790200000000
  implements MigrationInterface
{
  private readonly stagesTableName = 'project_gantt_stages'
  private readonly entriesTableName = 'project_report_entries'
  private readonly stageTypeIndexName =
    'idx_project_gantt_stages_project_id_stage_type'
  private readonly entrySourceIndexName =
    'idx_project_report_entries_project_source'
  private readonly entryStageIndexName =
    'idx_project_report_entries_gantt_stage_id'
  private readonly entryStageForeignKeyName =
    'fk_project_report_entries_gantt_stage_id'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.addStageColumns(queryRunner)
    await this.addEntryColumns(queryRunner)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropEntryColumns(queryRunner)
    await this.dropStageColumns(queryRunner)
  }

  private async addStageColumns(queryRunner: QueryRunner): Promise<void> {
    const hasStageTypeColumn = await queryRunner.hasColumn(
      this.stagesTableName,
      'stage_type',
    )

    if (!hasStageTypeColumn) {
      await queryRunner.addColumn(
        this.stagesTableName,
        new TableColumn({
          name: 'stage_type',
          type: 'enum',
          enum: [
            'payments',
            'tz_writing',
            'tz_signing',
            'development',
            'education',
            'delivery',
            'closing',
          ],
          isNullable: true,
        }),
      )
    }

    await this.createIndexIfMissing(
      queryRunner,
      this.stagesTableName,
      new TableIndex({
        name: this.stageTypeIndexName,
        columnNames: ['project_id', 'stage_type'],
      }),
    )
  }

  private async addEntryColumns(queryRunner: QueryRunner): Promise<void> {
    const entryColumns = [
      new TableColumn({
        name: 'source',
        type: 'enum',
        enum: ['project_report', 'gantt_incident'],
        default: "'project_report'",
      }),
      new TableColumn({
        name: 'gantt_stage_id',
        type: 'bigint',
        unsigned: true,
        isNullable: true,
      }),
      new TableColumn({
        name: 'gantt_date',
        type: 'date',
        isNullable: true,
      }),
    ]

    for (const column of entryColumns) {
      const hasColumn = await queryRunner.hasColumn(
        this.entriesTableName,
        column.name,
      )

      if (!hasColumn) {
        await queryRunner.addColumn(this.entriesTableName, column)
      }
    }

    await this.createIndexIfMissing(
      queryRunner,
      this.entriesTableName,
      new TableIndex({
        name: this.entrySourceIndexName,
        columnNames: ['project_id', 'source'],
      }),
    )
    await this.createIndexIfMissing(
      queryRunner,
      this.entriesTableName,
      new TableIndex({
        name: this.entryStageIndexName,
        columnNames: ['gantt_stage_id'],
      }),
    )
    await this.createForeignKeyIfMissing(
      queryRunner,
      this.entriesTableName,
      new TableForeignKey({
        name: this.entryStageForeignKeyName,
        columnNames: ['gantt_stage_id'],
        referencedTableName: this.stagesTableName,
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    )
  }

  private async dropStageColumns(queryRunner: QueryRunner): Promise<void> {
    await this.dropIndexIfExists(
      queryRunner,
      this.stagesTableName,
      this.stageTypeIndexName,
    )

    if (await queryRunner.hasColumn(this.stagesTableName, 'stage_type')) {
      await queryRunner.dropColumn(this.stagesTableName, 'stage_type')
    }
  }

  private async dropEntryColumns(queryRunner: QueryRunner): Promise<void> {
    await this.dropForeignKeyIfExists(
      queryRunner,
      this.entriesTableName,
      this.entryStageForeignKeyName,
    )
    await this.dropIndexIfExists(
      queryRunner,
      this.entriesTableName,
      this.entryStageIndexName,
    )
    await this.dropIndexIfExists(
      queryRunner,
      this.entriesTableName,
      this.entrySourceIndexName,
    )

    for (const columnName of ['gantt_date', 'gantt_stage_id', 'source']) {
      if (await queryRunner.hasColumn(this.entriesTableName, columnName)) {
        await queryRunner.dropColumn(this.entriesTableName, columnName)
      }
    }
  }

  private async createIndexIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    index: TableIndex,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName)
    const hasIndex = table?.indices.some(
      (existingIndex) => existingIndex.name === index.name,
    )

    if (!hasIndex) {
      await queryRunner.createIndex(tableName, index)
    }
  }

  private async dropIndexIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    indexName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName)
    const index = table?.indices.find(
      (existingIndex) => existingIndex.name === indexName,
    )

    if (index) {
      await queryRunner.dropIndex(tableName, index)
    }
  }

  private async createForeignKeyIfMissing(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKey: TableForeignKey,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName)
    const hasForeignKey = table?.foreignKeys.some(
      (existingForeignKey) => existingForeignKey.name === foreignKey.name,
    )

    if (!hasForeignKey) {
      await queryRunner.createForeignKey(tableName, foreignKey)
    }
  }

  private async dropForeignKeyIfExists(
    queryRunner: QueryRunner,
    tableName: string,
    foreignKeyName: string,
  ): Promise<void> {
    const table = await queryRunner.getTable(tableName)
    const foreignKey = table?.foreignKeys.find(
      (existingForeignKey) => existingForeignKey.name === foreignKeyName,
    )

    if (foreignKey) {
      await queryRunner.dropForeignKey(tableName, foreignKey)
    }
  }
}
