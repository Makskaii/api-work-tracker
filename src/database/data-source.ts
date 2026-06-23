import 'dotenv/config'
import { DataSource } from 'typeorm'
import { ClientPurchasedHoursEvent } from '../clients/entities/client-purchased-hours-event.entity'
import { Client } from '../clients/entities/client.entity'
import { Employee } from '../employee/entity/employee.entity'
import { GanttCustomEvent } from '../gantt/entities/gantt-custom-event.entity'
import { GanttIncidentFile } from '../gantt/entities/gantt-incident-file.entity'
import { GanttIncident } from '../gantt/entities/gantt-incident.entity'
import { ProjectGanttEvent } from '../project-reports/entities/project-gantt-event.entity'
import { ProjectGanttStage } from '../project-reports/entities/project-gantt-stage.entity'
import { ProjectPayment } from '../project-reports/entities/project-payment.entity'

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  username: process.env.DB_USERNAME || 'app_user',
  password: process.env.DB_PASSWORD || 'app_pass',
  database: process.env.DB_NAME || 'analytics_db',
  entities: [
    Client,
    ClientPurchasedHoursEvent,
    Employee,
    GanttCustomEvent,
    GanttIncident,
    GanttIncidentFile,
    ProjectGanttStage,
    ProjectGanttEvent,
    ProjectPayment,
  ],
  migrations: [__dirname + '/migrations/**/*{.ts,.js}'],
  synchronize: false,
})

