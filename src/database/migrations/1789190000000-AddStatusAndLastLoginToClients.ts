import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm'

export class AddStatusAndLastLoginToClients1789190000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasClientsTable = await queryRunner.hasTable('clients')

    if (!hasClientsTable) {
      return
    }

    const hasStatusColumn = await queryRunner.hasColumn('clients', 'status')

    if (!hasStatusColumn) {
      await queryRunner.addColumn(
        'clients',
        new TableColumn({
          name: 'status',
          type: 'enum',
          enum: ['active', 'inactive'],
          default: "'active'",
          isNullable: false,
        }),
      )
    }

    const hasLastLoginColumn = await queryRunner.hasColumn(
      'clients',
      'last_login',
    )

    if (!hasLastLoginColumn) {
      await queryRunner.addColumn(
        'clients',
        new TableColumn({
          name: 'last_login',
          type: 'datetime',
          isNullable: true,
        }),
      )
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasClientsTable = await queryRunner.hasTable('clients')

    if (!hasClientsTable) {
      return
    }

    const hasLastLoginColumn = await queryRunner.hasColumn(
      'clients',
      'last_login',
    )

    if (hasLastLoginColumn) {
      await queryRunner.dropColumn('clients', 'last_login')
    }

    const hasStatusColumn = await queryRunner.hasColumn('clients', 'status')

    if (hasStatusColumn) {
      await queryRunner.dropColumn('clients', 'status')
    }
  }
}
