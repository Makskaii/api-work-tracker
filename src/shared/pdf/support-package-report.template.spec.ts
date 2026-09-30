import { buildSupportPackageReportHtml, SupportPackageReportData } from './support-package-report.template'

const sample: SupportPackageReportData = {
  projectTitle: 'Поддержка', clientName: 'Клиент', packageId: 7,
  purchaseDate: '2026-09-01', asOfDate: '2026-09-29', purchasedHours: 80,
  spentHours: 14.5, remainingHours: 65.5,
  tasks: [{ id: '10', title: 'Обмен задачами', hours: 7, totalHours: 26, soldHours: 30, status: 'in_work', reports: [{ id: '1', date: '2026-09-15', description: 'Сохранены комментарии', hours: 7 }], otherPackageReports: [{ id: '3', date: '2026-08-01', description: 'Предыдущая работа', hours: 19, packageId: 6 }] }],
  reportsWithoutTask: [{ id: '2', date: '2026-09-16', description: 'Настроены права', hours: 7.5 }],
}

describe('support package PDF content', () => {
  it('shows actual work and package hours without exposing work or package dates', () => {
    const html = buildSupportPackageReportHtml(sample)
    expect(html).toContain('Пакет №7')
    expect(html).not.toContain('01.09.2026')
    expect(html).not.toContain('29.09.2026')
    expect(html).not.toContain('2026-09')
    expect(html).not.toContain('<th>Дата</th>')
    expect(html).toContain('14,5 ч')
    expect(html).toContain('65,5 ч')
    expect(html).toContain('Сохранены комментарии')
    expect(html).toContain('Настроены права')
    expect(html).toContain('Всего списано')
    expect(html).not.toContain('Неделя')
    expect(html).not.toContain('Коммуникации')
    expect(html).toContain('В работе')
    expect(html).toContain('26 / 30 ч')
    expect(html).toContain('Из выбранного пакета: 7 ч')
    expect(html).toContain('Предыдущая работа')
    expect(html).toContain('Учтено в пакете №6')
    expect(html).toContain('Не входит в этот пакет')
    expect(html).not.toContain('2026-08')
  })

  it('distinguishes completed tasks and missing budgets without pretending to know either value', () => {
    const completed = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], status: 'completed' }] })
    expect(completed).toContain('Выполнена')
    const cancelled = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], status: 'cancelled' }] })
    expect(cancelled).toContain('Отменена')
    const missing = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], status: 'unknown', soldHours: null }] })
    expect(missing).toContain('Статус недоступен')
    expect(missing).toContain('26 / — ч')
    expect(missing).toContain('Общий лимит часов по задаче не указан')
  })

  it('shows an assigned task as 0 / 30 before any reports without an empty work table or a package charge', () => {
    const html = buildSupportPackageReportHtml({
      ...sample, spentHours: 0, remainingHours: 80, reportsWithoutTask: [],
      tasks: [{ ...sample.tasks[0], hours: 0, totalHours: 0, reports: [], otherPackageReports: [] }],
    })
    expect(html).toContain('Обмен задачами')
    expect(html).toContain('В работе')
    expect(html).toContain('0 / 30 ч')
    expect(html).toContain('Сделано / Всего')
    expect(html).toContain('Из выбранного пакета: 0 ч')
    expect(html).toContain('Отчётов по задаче пока нет.')
    expect(html).not.toContain('<th>Выполненные работы</th>')
    expect(html).toContain('<span>Всего списано</span><span>0 ч</span>')
    expect(html).not.toContain('2026-09')
  })

  it('keeps old-package work visible for an assigned task and describes only the current package as having no reports', () => {
    const html = buildSupportPackageReportHtml({
      ...sample, spentHours: 0, remainingHours: 80, reportsWithoutTask: [],
      tasks: [{ ...sample.tasks[0], hours: 0, totalHours: 19, reports: [] }],
    })
    expect(html).toContain('19 / 30 ч')
    expect(html).toContain('В этом пакете отчётов по задаче пока нет.')
    expect(html).toContain('Предыдущая работа')
    expect(html).toContain('Учтено в пакете №6')
    expect(html.match(/<th>Выполненные работы<\/th>/g)).toHaveLength(1)
    expect(html).toContain('<span>Всего списано</span><span>0 ч</span>')
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

  it('labels unallocated task work separately from package charges, without dates or unsafe HTML', () => {
    const html = buildSupportPackageReportHtml({ ...sample, tasks: [{ ...sample.tasks[0], totalHours: 29,
      unallocatedReports: [{ id: '4', date: '2026-09-29', description: '<script>Pending</script>', hours: 3 }],
    }] })
    expect(html).toContain('29 / 30 ч')
    expect(html).toContain('Не распределено по пакетам; в итог пакета не входит')
    expect(html).toContain('&lt;script&gt;Pending&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('2026-09-29')
    expect(html).toContain('Из выбранного пакета: 7 ч')
    expect(html).toContain('14,5 ч')
  })
})
