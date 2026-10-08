import { buildSupportPackageReportHtml, SupportPackageReportData } from './support-package-report.template'

const sample: SupportPackageReportData = {
  projectTitle: 'Поддержка', clientName: 'Клиент', packageId: 7,
  purchaseDate: '2026-09-01', asOfDate: '2026-09-29', purchasedHours: 80,
  spentHours: 14.5, remainingHours: 65.5,
  tasks: [{ id: '10', title: 'Обмен задачами', hours: 7, totalHours: 26, soldHours: 30, status: 'in_work', reports: [{ id: '1', date: '2026-09-15', description: 'Сохранены комментарии', hours: 7 }], otherPackageReports: [{ id: '3', date: '2026-08-01', description: 'Предыдущая работа', hours: 19, packageId: 6 }] }],
  reportsWithoutTask: [{ id: '2', date: '2026-09-16', description: 'Настроены права', hours: 7.5 }],
}

describe('support package PDF content', () => {
  it('renders cabinet totals and task count without claiming the completed budget is an actual package charge', () => {
    const html = buildSupportPackageReportHtml({
      ...sample, reportBasis: 'client_cabinet', purchasedHours: 65, spentHours: 62, remainingHours: 3,
      tasks: Array.from({ length: 25 }, (_, index) => ({ ...sample.tasks[0], id: String(index), title: `Задача ${index}`, reports: [], clientReports: [], otherPackageReports: [] })),
      reportsWithoutTask: [],
    })
    expect(html).toContain('Задачи (25)')
    expect(html).toContain('<th>Куплено часов</th><th>Выполнено</th><th>Осталось</th>')
    expect(html).toContain('<td>65 ч</td><td>62 ч</td><td class="">3 ч</td>')
    expect(html).toContain('Задача 24')
    expect(html).toContain('В процессе')
    expect(html).not.toContain('Списано из пакета')
    expect(html).not.toContain('Всего списано из пакета')
    expect(html).not.toContain('Продано клиенту')
    expect(html).not.toContain('Сохранены комментарии')
    expect(html).not.toContain('Предыдущая работа')
  })

  it('labels period task volume separately from the overall current cabinet balance', () => {
    const html = buildSupportPackageReportHtml({
      ...sample, reportBasis: 'client_cabinet', dateFrom: '2026-09-10', dateTo: '2026-09-20', periodSpentHours: 30,
      tasks: [{ ...sample.tasks[0], status: 'completed', clientReports: [
        { id: '1', date: '2026-08-01', description: 'Работа до периода', hours: 1.7 },
        { id: '2', date: '2026-09-15', description: 'Работа в периоде', hours: 28.3 },
      ] }], reportsWithoutTask: [],
    })
    expect(html).toContain('Объём выполненных задач, попавших в период: <strong>30 ч</strong>')
    expect(html).toContain('Сводка отражает общий текущий баланс.')
    expect(html).toContain('Работа до периода')
    expect(html).toContain('1,7 ч')
    expect(html).not.toContain('01.08.2026')
    expect(html).not.toContain('15.09.2026')
    expect(html).not.toContain('Списано за выбранный период')
  })

  it('shows unfinished task volume and status without exposing work descriptions or internal allocation details', () => {
    const html = buildSupportPackageReportHtml(sample)
    expect(html).toContain('Пакет №7')
    expect(html).toContain('<h1>Отчёт по пакету часов</h1>')
    expect(html).not.toContain('01.09.2026')
    expect(html).not.toContain('29.09.2026')
    expect(html).not.toContain('2026-09')
    expect(html).not.toContain('<th>Дата</th>')
    expect(html).toContain('14,5 ч')
    expect(html).toContain('65,5 ч')
    expect(html).not.toContain('Сохранены комментарии')
    expect(html).toContain('Настроены права')
    expect(html).toContain('Всего списано из пакета')
    expect(html).toContain('<th>Списано из пакета</th>')
    expect(html).not.toContain('Неделя')
    expect(html).not.toContain('Коммуникации')
    expect(html).toContain('В процессе')
    expect(html).toContain('30 ч<small>Объём задачи</small>')
    expect(html).not.toContain('26 / 30')
    expect(html).not.toContain('Сделано / Всего')
    expect(html).not.toContain('Продано клиенту')
    expect(html).not.toContain('Из выбранного пакета:')
    expect(html).not.toContain('Предыдущая работа')
    expect(html).not.toContain('Учтено в пакете №6')
    expect(html).not.toContain('Не входит в этот пакет')
    expect(html).not.toContain('2026-08')
  })

  it('distinguishes completed tasks and missing budgets without pretending to know either value', () => {
    const completed = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], status: 'completed' }] })
    expect(completed).toContain('Выполнена')
    expect(completed).toContain('Сохранены комментарии')
    expect(completed).toContain('30 ч<small>Объём задачи</small>')
    const cancelled = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], status: 'cancelled' }] })
    expect(cancelled).toContain('Отменена')
    expect(cancelled).not.toContain('Сохранены комментарии')
    const missing = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], status: 'unknown', soldHours: null }] })
    expect(missing).toContain('Статус недоступен')
    expect(missing).toContain('Не указан<small>Объём задачи</small>')
    expect(missing).not.toContain('Сохранены комментарии')
  })

  it('shows an assigned task before any reports without an empty work table or a misleading empty-package banner', () => {
    const html = buildSupportPackageReportHtml({
      ...sample, spentHours: 0, remainingHours: 80, reportsWithoutTask: [],
      tasks: [{ ...sample.tasks[0], hours: 0, totalHours: 0, reports: [], otherPackageReports: [] }],
    })
    expect(html).toContain('Обмен задачами')
    expect(html).toContain('В процессе')
    expect(html).toContain('30 ч<small>Объём задачи</small>')
    expect(html).not.toContain('0 / 30 ч')
    expect(html).not.toContain('Сделано / Всего')
    expect(html).not.toContain('Из выбранного пакета:')
    expect(html).not.toContain('Отчётов по задаче пока нет.')
    expect(html).not.toContain('<p class="empty">')
    expect(html).not.toContain('<th>Выполненные работы</th>')
    expect(html).toContain('<span>Всего списано из пакета</span><span>0 ч</span>')
    expect(html).not.toContain('2026-09')
  })

  it('does not expose old-package descriptions for completed tasks without current client work', () => {
    const html = buildSupportPackageReportHtml({
      ...sample, spentHours: 0, remainingHours: 80, reportsWithoutTask: [],
      tasks: [{ ...sample.tasks[0], status: 'completed', hours: 0, totalHours: 19, reports: [] }],
    })
    expect(html).toContain('Описание выполненных работ пока не добавлено.')
    expect(html).not.toContain('Предыдущая работа')
    expect(html).not.toContain('Учтено в пакете №6')
    expect(html).not.toContain('<th>Выполненные работы</th>')
    expect(html).not.toContain('<p class="empty">')
    expect(html).toContain('<span>Всего списано из пакета</span><span>0 ч</span>')
  })

  it('renders Bitrix content as text and cannot insert external assets or executable HTML', () => {
    const html = buildSupportPackageReportHtml({
      ...sample,
      projectTitle: '<script>fetch("https://example.test")</script>',
      tasks: [],
      reportsWithoutTask: [{ id: '2', date: '2026-09-16', description: '<img src="https://example.test/private">\nNext line & detail', hours: 7.5 }],
    }, 'https://example.test/tracking.png')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=&quot;https://example.test/private&quot;&gt;')
    expect(html).toContain('\nNext line &amp; detail')
  })

  it('uses normalized commercial rows for completed tasks without altering package charge totals', () => {
    const html = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], totalHours: 29,
      status: 'completed',
      clientReports: [{ id: '1', date: '2026-09-15', description: '<script>Согласованный результат</script>', hours: 30 }],
      unallocatedReports: [{ id: '4', date: '2026-09-29', description: '<script>Pending</script>', hours: 3 }],
    }] })
    expect(html).toContain('&lt;script&gt;Согласованный результат&lt;/script&gt;')
    expect(html).toContain('<td class="report-hours">30 ч</td>')
    expect(html).not.toContain('Сохранены комментарии')
    expect(html).not.toContain('Pending')
    expect(html).not.toContain('Не распределено')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('2026-09-29')
    expect(html).toContain('14,5 ч')
    expect(html).toContain('65,5 ч')
    expect(html).toContain('В сводке указаны фактические списания и остаток пакета.')
  })

  it('honours an explicitly empty client work list instead of exposing fallback report descriptions', () => {
    const html = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], status: 'completed', clientReports: [] }], reportsWithoutTask: [] })
    expect(html).toContain('Описание выполненных работ пока не добавлено.')
    expect(html).not.toContain('Сохранены комментарии')
    expect(html).not.toContain('<th>Выполненные работы</th>')
  })

  it('shows an explicitly requested aggregate period without exposing individual work dates', () => {
    const html = buildSupportPackageReportHtml({ ...sample, dateFrom: '2026-09-10', dateTo: '2026-09-20', periodSpentHours: 7.5,
      tasks: [{ ...sample.tasks[0], status: 'completed' }],
    })
    expect(html).toContain('Период отчёта: 10.09.2026 - 20.09.2026')
    expect(html).toContain('<h1>Отчёт за период</h1>')
    expect(html).toContain('В сводке указаны фактические списания и остаток пакета на конец выбранного периода.')
    expect(html).toContain('Списано за выбранный период: <strong>7,5 ч</strong>')
    expect(html).not.toContain('15.09.2026')
    expect(html).not.toContain('16.09.2026')
    expect(html).not.toContain('2026-09')
    expect(html).toContain('14,5 ч')
    expect(html).toContain('65,5 ч')
  })

  it('shows an empty-package message only when there are no tasks or standalone works', () => {
    const html = buildSupportPackageReportHtml({ ...sample, tasks: [], reportsWithoutTask: [], spentHours: 0, remainingHours: 80 })
    expect(html).toContain('В этом пакете пока нет задач и выполненных работ.')
    expect(html).not.toContain('<h2>Задачи</h2>')
    expect(html).not.toContain('<th>Выполненные работы</th>')
  })

  it('keeps an empty selected period distinct from an empty package with no earlier charges', () => {
    const html = buildSupportPackageReportHtml({ ...sample, dateFrom: '2026-09-20', dateTo: '2026-09-20', periodSpentHours: 0, tasks: [], reportsWithoutTask: [] })
    expect(html).toContain('В выбранном периоде работ по этому пакету нет.')
    expect(html).not.toContain('В этом пакете пока нет задач и выполненных работ.')
    expect(html).toContain('14,5 ч')
    expect(html).toContain('65,5 ч')
    expect(html).toContain('Списано за выбранный период: <strong>0 ч</strong>')
  })

  it('keeps an explicit zero task volume distinct from a missing volume', () => {
    const html = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], soldHours: 0 }] })
    expect(html).toContain('0 ч<small>Объём задачи</small>')
    expect(html).not.toContain('Не указан<small>Объём задачи</small>')
  })
})
