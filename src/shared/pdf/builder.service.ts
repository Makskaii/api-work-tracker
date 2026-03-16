import { Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import { TaskCodes } from 'src/constants/const'
import { GroupedTasksWithTimeSpent } from 'src/types/reports'
import { TaskProps } from 'src/types/tasks'

type SummaryRow = {
  label: string
  value: string
}

type BuildReportParams = {
  groupedTasks: GroupedTasksWithTimeSpent
  summaryRows: SummaryRow[]
  periodText: string
  departmentTitle?: string
  logoUrl?: string
  watermarkUrl?: string
}

@Injectable()
export class HtmlBuilderService {
  buildReportHtml({
    groupedTasks,
    summaryRows,
    periodText,
    departmentTitle = 'отдела разработки',
    logoUrl,
    watermarkUrl,
  }: BuildReportParams) {
    const sortedDates = Object.keys(groupedTasks).sort(
      (a, b) => dayjs(a).valueOf() - dayjs(b).valueOf(),
    )

    const summaryTableHtml = summaryRows
      .map(
        (row) => `
          <tr>
            <td>${this.escapeHtml(row.label)}</td>
            <td>${this.escapeHtml(row.value)}</td>
          </tr>
        `,
      )
      .join('')

    const groupedTasksHtml = sortedDates
      .map((date, dateIndex) => {
        const tasks = groupedTasks[date] ?? []

        const tasksHtml = tasks
          .map((task, taskIndex) => {
            const description = this.escapeHtml(
              String(task[TaskCodes.description] ?? ''),
            ).replace(/\n/g, '<br />')

            const spent = task.timeSpent
              ? `${this.escapeHtml(String(task.timeSpent))} ч.`
              : null

            return `
              <div class="task-entry">
                <div class="task-line">
                  <span class="task-line-number">${taskIndex + 1}.</span>
                  <span class="task-line-title">${this.escapeHtml(task.title ?? '')}</span>
                </div>

                ${
                  spent
                    ? `
                      <div class="task-meta" style="font-style:italic">
                        <span class="task-meta-label">Трудозатраты:</span>
                        <span>${spent}</span>
                      </div>
                    `
                    : ''
                }

                ${
                  description
                    ? `
                      <div class="task-description">
                        ${description}
                      </div>
                    `
                    : ''
                }
              </div>
            `
          })
          .join('')

        return `
          <div class="date-section">
            <div class="date-subtitle">3.${dateIndex + 1}. ${dayjs(date).format('DD.MM.YYYY')}</div>
            ${tasksHtml || '<div class="empty">Задачи за эту дату отсутствуют</div>'}
          </div>
        `
      })
      .join('')

    return `
      <!DOCTYPE html>
      <html lang="ru">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Отчет по задачам отдела разработки</title>

          <style>
            @page {
              size: A4;
              margin: 90px 32px 70px 32px;
            }

            * {
              box-sizing: border-box;
            }

            html, body {
              margin: 0;
              padding: 0;
              font-family: Arial, Helvetica, sans-serif;
              color: #222;
              font-size: 13px;
              line-height: 1.45;
              background: #fff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            body {
              position: relative;
            }

            .document {
              position: relative;
              z-index: 1;
              width: 100%;
            }

            .watermark {
              position: fixed;
              top: 50%;
              left: 50%;
              width: 720px;
              height: 720px;
              transform: translate(-50%, -50%);
              pointer-events: none;
              z-index: 0;
    
              background-image: url('${watermarkUrl ?? ''}');
              background-repeat: no-repeat;
              background-position: center;
              background-size: contain;
            }

            .watermark img {
              width: 65%;
              max-width: 520px;
              object-fit: contain;
            }

            .document {
              position: relative;
              z-index: 1;
              width: 100%;
            }

            .top-brand {
              display: flex;
              align-items: center;
              gap: 16px;
              margin-bottom: 20px;
            }

            .top-brand-logo {
              width: 72px;
              height: 72px;
              object-fit: contain;
              flex-shrink: 0;
            }

            .top-brand-title {
              font-size: 22px;
              font-weight: 700;
              line-height: 1.25;
              margin: 0;
            }

            .section-list {
              margin: 0;
              padding-left: 22px;
            }

            .section-list > li {
              margin-bottom: 18px;
            }

            .section-title {
              font-weight: 700;
              font-size: 15px;
              margin-bottom: 10px;
            }

            .sub-list {
              margin: 8px 0 0;
              padding-left: 22px;
            }

            .sub-list > li {
              margin-bottom: 8px;
            }

            .paragraph {
              margin: 8px 0 0 0;
              text-align: justify;
            }

            .summary-table-wrap {
              margin-top: 10px;
              max-width: 720px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              font-size: 13px;
            }

            th,
            td {
              border: 1px solid #444;
              padding: 8px 10px;
              vertical-align: top;
              text-align: left;
              word-break: break-word;
            }

            th {
              background: #f3f3f3;
              font-weight: 700;
            }

            .date-section {
              margin-top: 14px;
              page-break-inside: avoid;
            }

            .date-subtitle {
              font-weight: 700;
              font-size: 14px;
              margin-bottom: 10px;
            }

            .task-entry {
              margin-bottom: 14px;
              page-break-inside: avoid;
            }

            .task-line {
              display: flex;
              align-items: flex-start;
              gap: 6px;
              font-weight: 700;
            }

            .task-line-number {
              min-width: 18px;
            }

            .task-line-title {
              display: inline-block;
            }

            .task-meta {
              margin: 4px 0 0 24px;
            }

            .task-meta-label {
              font-weight: 700;
            }

            .task-description {
              margin: 6px 0 0 24px;
              text-align: justify;
              white-space: normal;
              word-break: break-word;
            }

            .empty {
              color: #666;
              font-style: italic;
            }


          
          </style>
        </head>

       <body>
        ${watermarkUrl ? `<div class="watermark"></div>` : ''}


          <div class="document">
            <div class="top-brand">
              <h1 class="top-brand-title" style="color:rgb(60, 134, 140)">
                Отчет по задачам ${this.escapeHtml(departmentTitle)}:
              </h1>
            </div>

            <ol class="section-list">
              <li>
                <div class="section-title">Общие сведения</div>

                <ol class="sub-list">
                  <li>
                    <strong color: "rgb(60, 134, 140)">Период и назначение документа</strong>
                    <p class="paragraph">
                      Документ отражает перечень задач ${this.escapeHtml(
                        departmentTitle.toLowerCase(),
                      )} за период
                      ${this.escapeHtml(periodText)},
                      сформированный на основании предоставленных заказчиком запросов.
                      \n
                      Статусы фактического закрытия задач, сроки завершения и комментарии
                      при необходимости уточняются отдельно.
                    </p>
                  </li>
                </ol>
              </li>

              <li>
                <div class="section-title">Сводка по задачам</div>

                <ol class="sub-list">
                  <li><strong>Общая информация</strong></li>
                </ol>

                <div class="summary-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style="background:rgb(60, 134, 140)">Показатель</th>
                        <th style="background:rgb(60, 134, 140)">Значение</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${summaryTableHtml}
                    </tbody>
                  </table>
                </div>
              </li>

              <li>
                <div class="section-title">Перечень задач по датам</div>
                ${groupedTasksHtml || '<div class="empty">Нет данных за выбранный период</div>'}
              </li>
            </ol>
          </div>
        </body>
      </html>
    `
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
