import { BadRequestException } from '@nestjs/common'
import type { CompanyReportPresentation } from '../clients/clients.service'
import type { ClientTaskResponseDto } from '../clients/dto/client-task-response.dto'
import { ClientTaskStatuses, TaskCodes } from '../constants/const'
import { buildSupportPackageReportHtml } from '../shared/pdf/support-package-report.template'
import type { SupportClientWork } from './support-client-work-reader.service'
import { buildSupportCabinetReportData } from './support-hours-package-report.service'

const now = new Date('2026-10-08T10:00:00Z')
const context = {
  packageId: 10,
  projectTitle: 'Уника — техподдержка',
  companyTitle: 'Уника',
  purchaseDate: '2026-09-01',
}

function fixture(): CompanyReportPresentation {
  const completedBudgets = [3, 19, 40]
  const tasks: ClientTaskResponseDto[] = Array.from(
    { length: 25 },
    (_, index) => ({
      id: String(100 + index),
      title: `Задача ${index + 1}`,
      status: index < 3 ? ClientTaskStatuses.done : ClientTaskStatuses.inWork,
      [TaskCodes.hours]: index < 3 ? completedBudgets[index] : 100,
      // The cabinet is company-wide, including tasks outside this package's project.
      [TaskCodes.parentproject]: index % 2 ? 999 : 97,
    }),
  )
  return {
    tasks,
    purchasedHours: 65,
    completedHours: 62,
    completedTaskCount: 3,
    completedTaskIds: ['100', '101', '102'],
    statsPeriod: { start: '2026-04-01', end: '2026-10-08T20:59:59.999Z' },
  }
}

function work(
  id: string,
  taskId: string,
  date: string,
  hours: number,
  description: string,
): SupportClientWork {
  return { taskId, row: { id, date, hours, description } }
}

function works(): SupportClientWork[] {
  return [
    work('1', '100', '2026-03-20', 1.8, 'Историческая диагностика'),
    work('2', '100', '2026-10-01', 1.4, 'Завершённая настройка'),
    work('3', '101', '2026-09-15', 57.35, 'Исправление интеграции'),
    work('4', '103', '2026-10-01', 0, 'Описание незавершённой работы'),
  ]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

describe('Support PDF mirrors the current client cabinet', () => {
  it('keeps all 25 cabinet tasks and its 65 / 62 / 3 totals instead of actual work or open-task budgets', () => {
    const presentation = fixture()
    const sourceWorks = works()
    expect(
      sourceWorks.reduce((sum, item) => sum + item.row.hours, 0),
    ).toBeCloseTo(60.55)

    const data = buildSupportCabinetReportData(
      context,
      presentation,
      sourceWorks,
      now,
    )

    expect(data).toMatchObject({
      reportBasis: 'client_cabinet',
      purchasedHours: 65,
      spentHours: 62,
      remainingHours: 3,
      completedTaskCount: 3,
    })
    expect(data.tasks.map((task) => task.id)).toEqual(
      presentation.tasks.map((task) => task.id),
    )
    expect(data.tasks).toHaveLength(25)
    expect(data.tasks.find((task) => task.id === '102')).toMatchObject({
      soldHours: 40,
      status: 'completed',
      reports: [],
      clientReports: [],
    })
    expect(data.tasks.find((task) => task.id === '124')).toMatchObject({
      soldHours: 100,
      status: 'in_work',
      reports: [],
      clientReports: [],
    })
    expect(data.reportsWithoutTask).toEqual([])
    expect(buildSupportPackageReportHtml(data)).toContain(
      '<h2>Задачи (25)</h2>',
    )
  })

  it('shows completed descriptions from full history and readable proportional hours, hiding open-task descriptions', () => {
    const data = buildSupportCabinetReportData(context, fixture(), works(), now)
    const completed = data.tasks.find((task) => task.id === '100')
    expect(completed?.reports.map((row) => row.hours)).toEqual([1.8, 1.4])
    expect(completed?.clientReports?.map((row) => row.hours)).toEqual([
      1.7, 1.3,
    ])
    expect(completed?.totalHours).toBe(3.2)
    expect(
      completed?.clientReports?.reduce((sum, row) => sum + row.hours, 0),
    ).toBe(3)
    expect(data.tasks.find((task) => task.id === '103')).toMatchObject({
      soldHours: 100,
      status: 'in_work',
      clientReports: [],
      reports: [
        { id: '4', hours: 0, description: 'Описание незавершённой работы' },
      ],
    })

    const html = buildSupportPackageReportHtml(data)
    expect(html).toContain('Историческая диагностика')
    expect(html).toContain('Завершённая настройка')
    expect(html).toContain('1,7 ч')
    expect(html).toContain('1,3 ч')
    expect(html).toContain('В процессе')
    expect(html).not.toContain('Описание незавершённой работы')
    expect(html).toContain('Описание выполненных работ пока не добавлено.')
  })

  it('includes a touched task whole for a period while keeping the overall cabinet balance', () => {
    const data = buildSupportCabinetReportData(
      context,
      fixture(),
      works(),
      now,
      {
        dateFrom: '2026-10-01',
        dateTo: '2026-10-01',
      },
    )

    expect(data.tasks.map((task) => task.id)).toEqual(['100', '103'])
    expect(data.tasks[0].reports.map((row) => row.date)).toEqual([
      '2026-03-20',
      '2026-10-01',
    ])
    expect(data.tasks[0].clientReports?.map((row) => row.hours)).toEqual([
      1.7, 1.3,
    ])
    expect(data).toMatchObject({
      purchasedHours: 65,
      spentHours: 62,
      remainingHours: 3,
      periodSpentHours: 3,
    })
  })

  it('does not use package purchase dates as a historical cutoff for cabinet tasks', () => {
    const data = buildSupportCabinetReportData(
      context,
      fixture(),
      works(),
      now,
      {
        dateFrom: '2026-03-20',
        dateTo: '2026-03-20',
      },
    )
    expect(data.tasks.map((task) => task.id)).toEqual(['100'])
    expect(data.tasks[0].reports).toHaveLength(2)
    expect(data.periodSpentHours).toBe(3)
  })

  it('asks for purchased client hours instead of inventing a package-based balance', () => {
    expect(() =>
      buildSupportCabinetReportData(
        context,
        { ...fixture(), purchasedHours: null },
        works(),
        now,
      ),
    ).toThrow(BadRequestException)
    expect(() =>
      buildSupportCabinetReportData(
        context,
        { ...fixture(), purchasedHours: null },
        works(),
        now,
      ),
    ).toThrow(
      'Укажите купленные часы в кабинете клиента перед формированием отчёта',
    )
  })

  it('does not mutate source tasks, completed totals, or actual report hours while sorting and distributing', () => {
    const presentation = deepFreeze(fixture())
    const sourceWorks = deepFreeze([...works()].reverse())
    const before = JSON.stringify({ presentation, sourceWorks })

    const data = buildSupportCabinetReportData(
      context,
      presentation,
      sourceWorks,
      now,
    )

    expect(JSON.stringify({ presentation, sourceWorks })).toBe(before)
    expect(data.tasks[0].reports.map((row) => row.id)).toEqual(['1', '2'])
    expect(data.tasks[0].clientReports?.map((row) => row.hours)).toEqual([
      1.7, 1.3,
    ])
    expect(data.tasks[0].reports[0]).not.toBe(
      sourceWorks.find((item) => item.row.id === '1')?.row,
    )
  })
})
