import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddClientPurchasedHoursPaymentFields1790700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasEventsTable = await queryRunner.hasTable(
      'client_purchased_hours_events',
    )

    if (!hasEventsTable) {
      return
    }

    const hasDateColumn = await queryRunner.hasColumn(
      'client_purchased_hours_events',
      'date',
    )

    if (!hasDateColumn) {
      await queryRunner.addColumn(
        'client_purchased_hours_events',
        new TableColumn({
          name: 'date',
          type: 'date',
          isNullable: true,
        }),
      )
    }

    const hasAmountColumn = await queryRunner.hasColumn(
      'client_purchased_hours_events',
      'amount',
    )

    if (!hasAmountColumn) {
      await queryRunner.addColumn(
        'client_purchased_hours_events',
        new TableColumn({
          name: 'amount',
          type: 'decimal',
          precision: 12,
          scale: 2,
          isNullable: true,
        }),
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasEventsTable = await queryRunner.hasTable(
      'client_purchased_hours_events',
    )

    if (!hasEventsTable) {
      return
    }

    const hasAmountColumn = await queryRunner.hasColumn(
      'client_purchased_hours_events',
      'amount',
    )

    if (hasAmountColumn) {
      await queryRunner.dropColumn('client_purchased_hours_events', 'amount')
    }

    const hasDateColumn = await queryRunner.hasColumn(
      'client_purchased_hours_events',
      'date',
    )

    if (hasDateColumn) {
      await queryRunner.dropColumn('client_purchased_hours_events', 'date')
    }
  }
}
