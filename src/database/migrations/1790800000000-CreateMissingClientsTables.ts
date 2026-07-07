import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
} from 'typeorm'

export class CreateMissingClientsTables1790800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.ensureClientsTable(queryRunner)
    await this.ensurePurchasedHoursEventsTable(queryRunner)
  }

  public async down(): Promise<void> {}

  private async ensureClientsTable(queryRunner: QueryRunner): Promise<void> {
    const hasClientsTable = await queryRunner.hasTable('clients')

    if (!hasClientsTable) {
      await queryRunner.createTable(
        new Table({
          name: 'clients',
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
              name: 'name',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'email',
              type: 'varchar',
              length: '255',
              isNullable: false,
              isUnique: true,
            },
            {
              name: 'password_hash',
              type: 'varchar',
              length: '255',
              isNullable: false,
            },
            {
              name: 'crm_client_id',
              type: 'bigint',
              isNullable: false,
              isUnique: true,
            },
            {
              name: 'status',
              type: 'enum',
              enum: ['active', 'inactive'],
              default: "'active'",
              isNullable: false,
            },
            {
              name: 'last_login',
              type: 'datetime',
              isNullable: true,
            },
            {
              name: 'purchased_hours',
              type: 'decimal',
              precision: 8,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
            {
              name: 'updated_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              onUpdate: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
          ],
        }),
      )
      return
    }

    await this.ensureColumn(
      queryRunner,
      'clients',
      new TableColumn({
        name: 'status',
        type: 'enum',
        enum: ['active', 'inactive'],
        default: "'active'",
        isNullable: false,
      }),
    )
    await this.ensureColumn(
      queryRunner,
      'clients',
      new TableColumn({
        name: 'last_login',
        type: 'datetime',
        isNullable: true,
      }),
    )
    await this.ensureColumn(
      queryRunner,
      'clients',
      new TableColumn({
        name: 'purchased_hours',
        type: 'decimal',
        precision: 8,
        scale: 2,
        isNullable: true,
      }),
    )
  }

  private async ensurePurchasedHoursEventsTable(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const hasEventsTable = await queryRunner.hasTable(
      'client_purchased_hours_events',
    )

    if (!hasEventsTable) {
      await queryRunner.createTable(
        new Table({
          name: 'client_purchased_hours_events',
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
              name: 'client_id',
              type: 'bigint',
              unsigned: true,
              isNullable: false,
            },
            {
              name: 'type',
              type: 'enum',
              enum: ['added', 'removed'],
              isNullable: false,
            },
            {
              name: 'hours',
              type: 'decimal',
              precision: 8,
              scale: 2,
              isNullable: false,
            },
            {
              name: 'amount',
              type: 'decimal',
              precision: 12,
              scale: 2,
              isNullable: true,
            },
            {
              name: 'balance_after',
              type: 'decimal',
              precision: 8,
              scale: 2,
              isNullable: false,
            },
            {
              name: 'date',
              type: 'date',
              isNullable: true,
            },
            {
              name: 'comment',
              type: 'text',
              isNullable: true,
            },
            {
              name: 'created_at',
              type: 'datetime',
              default: 'CURRENT_TIMESTAMP',
              isNullable: false,
            },
          ],
        }),
      )
    } else {
      await this.ensureColumn(
        queryRunner,
        'client_purchased_hours_events',
        new TableColumn({
          name: 'amount',
          type: 'decimal',
          precision: 12,
          scale: 2,
          isNullable: true,
        }),
      )
      await this.ensureColumn(
        queryRunner,
        'client_purchased_hours_events',
        new TableColumn({
          name: 'date',
          type: 'date',
          isNullable: true,
        }),
      )
    }

    await this.ensurePurchasedHoursEventsForeignKey(queryRunner)
  }

  private async ensurePurchasedHoursEventsForeignKey(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const table = await queryRunner.getTable('client_purchased_hours_events')
    const hasForeignKey = table?.foreignKeys.some(
      (foreignKey) =>
        foreignKey.columnNames.length === 1 &&
        foreignKey.columnNames[0] === 'client_id' &&
        foreignKey.referencedTableName === 'clients',
    )

    if (hasForeignKey) {
      return
    }

    await queryRunner.createForeignKey(
      'client_purchased_hours_events',
      new TableForeignKey({
        columnNames: ['client_id'],
        referencedTableName: 'clients',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    )
  }

  private async ensureColumn(
    queryRunner: QueryRunner,
    tableName: string,
    column: TableColumn,
  ): Promise<void> {
    const hasColumn = await queryRunner.hasColumn(tableName, column.name)

    if (hasColumn) {
      return
    }

    await queryRunner.addColumn(tableName, column)
  }
}
