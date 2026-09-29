export type SupportPackageReportRow = {
  id: string
  date: string
  description: string
  hours: number
}

export type SupportPackageReportData = {
  projectTitle: string
  clientName: string | null
  packageId: number
  purchaseDate: string
  asOfDate: string
  purchasedHours: number
  spentHours: number
  remainingHours: number
  tasks: Array<{
    id: string
    title: string
    hours: number
    reports: SupportPackageReportRow[]
  }>
  reportsWithoutTask: SupportPackageReportRow[]
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character] ?? character))

const hours = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} ч`
const reportRows = (reports: SupportPackageReportRow[]) => reports.map((report) => `
  <tr>
    <td class="report-description">${escapeHtml(report.description || `Отчёт №${report.id}`)}</td>
    <td class="report-hours">${escapeHtml(hours(report.hours))}</td>
  </tr>`).join('')

const reportTable = (reports: SupportPackageReportRow[]) => `
  <table class="reports-table">
    <colgroup><col><col class="hours-column"></colgroup>
    <thead><tr><th>Выполненные работы</th><th class="report-hours">Часы</th></tr></thead>
    <tbody>${reportRows(reports)}</tbody>
  </table>`

/** The report uses actual package charges, not task estimates or completion status. */
export const buildSupportPackageReportHtml = (data: SupportPackageReportData, watermarkUrl?: string): string => {
  const reportCount = data.tasks.reduce((total, task) => total + task.reports.length, data.reportsWithoutTask.length)
  const tasksHtml = data.tasks.map((task, index) => `
    <section class="task-block">
      <div class="task-heading">
        <h3>${index + 1}. ${escapeHtml(task.title)}</h3>
        <strong>${escapeHtml(hours(task.hours))}</strong>
      </div>
      ${reportTable(task.reports)}
    </section>`).join('')
  // Only locally embedded artwork is allowed; report text cannot introduce remote resources.
  const watermark = watermarkUrl?.startsWith('data:image/')
    ? `<img class="watermark" src="${escapeHtml(watermarkUrl)}" alt="">`
    : ''

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Отчёт по пакету №${data.packageId} - ${escapeHtml(data.projectTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #222; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .watermark { position: fixed; z-index: 0; width: 550px; max-width: 90%; top: 25%; left: 5%; opacity: 0.025; }
    main { position: relative; z-index: 1; }
    .eyebrow { margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1.2px; font-size: 10px; color: #3c868c; font-weight: 700; }
    h1 { font-size: 24px; line-height: 1.2; margin: 0 0 10px; overflow-wrap: anywhere; }
    .project-name { margin: 0 0 4px; font-size: 17px; font-weight: 700; overflow-wrap: anywhere; }
    .client-name { margin: 0 0 12px; color: #555; }
    .report-meta { margin: 0 0 20px; color: #555; }
    .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; table-layout: fixed; break-inside: avoid; }
    .summary-table th { background: #3c868c; color: #fff; font-size: 11px; font-weight: 400; text-align: left; padding: 9px 12px; border: 1px solid #3c868c; }
    .summary-table td { border: 1px solid #cddddd; padding: 10px 12px; font-size: 24px; font-weight: 700; vertical-align: top; }
    .summary-table .negative { color: #b63b42; }
    .scope-note { color: #626970; font-size: 10px; margin: 0 0 22px; }
    h2 { margin: 23px 0 12px; font-size: 16px; color: #316f74; break-after: avoid; page-break-after: avoid; }
    .task-block { margin: 0 0 18px; }
    .task-heading { display: flex; align-items: flex-start; gap: 16px; margin: 0; padding: 9px 10px; background: #eef5f5; border: 1px solid #d5e1e1; border-bottom: 0; break-after: avoid; page-break-after: avoid; }
    h3 { flex: 1; min-width: 0; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
    .task-heading strong { white-space: nowrap; color: #316f74; }
    .reports-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .hours-column { width: 70px; }
    .reports-table thead { display: table-header-group; }
    .reports-table th { background: #f5f7f7; font-size: 10px; font-weight: 400; color: #626970; text-align: left; }
    .reports-table th, .reports-table td { border: 1px solid #d5e1e1; padding: 8px 10px; vertical-align: top; }
    .reports-table tr { break-inside: avoid; page-break-inside: avoid; }
    .report-description { white-space: pre-wrap; overflow-wrap: anywhere; }
    .reports-table .report-hours { text-align: right; white-space: nowrap; }
    .totals { display: flex; justify-content: space-between; gap: 20px; margin-top: 20px; padding-top: 10px; border-top: 2px solid #3c868c; font-weight: 700; break-inside: avoid; }
    .empty { border: 1px solid #d5e1e1; padding: 18px; color: #626970; }
  </style>
</head>
<body>${watermark}<main>
  <p class="eyebrow">Техническая поддержка</p>
  <h1>Отчёт по пакету часов</h1>
  <p class="project-name">${escapeHtml(data.projectTitle)}</p>
  ${data.clientName ? `<p class="client-name">${escapeHtml(data.clientName)}</p>` : ''}
  <p class="report-meta">Пакет №${data.packageId}</p>
  <table class="summary-table"><thead><tr><th>Объём пакета</th><th>Потрачено</th><th>Осталось</th></tr></thead>
  <tbody><tr><td>${escapeHtml(hours(data.purchasedHours))}</td><td>${escapeHtml(hours(data.spentHours))}</td><td class="${data.remainingHours < 0 ? 'negative' : ''}">${escapeHtml(hours(data.remainingHours))}</td></tr></tbody></table>
  <p class="scope-note">Учтены списания из выбранного пакета. Если работа оплачена из нескольких пакетов, здесь показаны только часы этого пакета.</p>
  ${tasksHtml ? `<h2>Работы по задачам</h2>${tasksHtml}` : ''}
  ${data.reportsWithoutTask.length ? `<h2>Отдельные работы</h2>${reportTable(data.reportsWithoutTask)}` : ''}
  ${reportCount === 0 ? '<p class="empty">В этом пакете пока нет списаний за выполненные работы.</p>' : ''}
  <div class="totals"><span>Всего списано</span><span>${escapeHtml(hours(data.spentHours))}</span></div>
</main></body></html>`
}
