import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableForeignKey,
} from 'typeorm'

export class AddPurchasedHoursToClients1789276400000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasClientsTable = await queryRunner.hasTable('clients')

    if (!hasClientsTable) {
      return
    }

    const hasPurchasedHoursColumn = await queryRunner.hasColumn(
      'clients',
      'purchased_hours',
    )

    if (!hasPurchasedHoursColumn) {
      await queryRunner.addColumn(
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

    const hasEventsTable = await queryRunner.hasTable(
      'client_purchased_hours_events',
    )

    if (hasEventsTable) {
      return
    }

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
            name: 'balance_after',
            type: 'decimal',
            precision: 8,
            scale: 2,
            isNullable: false,
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasEventsTable = await queryRunner.hasTable(
      'client_purchased_hours_events',
    )

    if (hasEventsTable) {
      await queryRunner.dropTable('client_purchased_hours_events', true)
    }

    const hasClientsTable = await queryRunner.hasTable('clients')

    if (!hasClientsTable) {
      return
    }

    const hasPurchasedHoursColumn = await queryRunner.hasColumn(
      'clients',
      'purchased_hours',
    )

    if (hasPurchasedHoursColumn) {
      await queryRunner.dropColumn('clients', 'purchased_hours')
    }
  }
}
