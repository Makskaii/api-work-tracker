import { Injectable } from '@nestjs/common'
import { DailyReportCodes, TaskCodes } from 'src/constants/const'
import { BitrixClients, ClientProjects } from 'src/types/bitrix'
import {
  GroupedTasksWithTimeSpent,
  ReportProps,
  TaskWithResult,
  TaskWithTimeSpent,
} from 'src/types/reports'
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

type BuildClientReportParams = {
  client: BitrixClients

  projects: {
    project: ClientProjects
    tasks: TaskWithResult[]
  }[]

  periodText: string

  watermarkUrl?: string

  summaryRows?: { label: string; value: string }[]

  commsData?: {
    firstWeekComms: {
      start: string
      end: string
      spent: number
      externalComms: ReportProps[]
      internalComms: ReportProps[]
    }
    secondWeekComms: {
      start: string
      end: string
      spent: number
      externalComms: ReportProps[]
      internalComms: ReportProps[]
    }
  }
}

@Injectable()
export class HtmlBuilderService {
  buildReportHtml({
    groupedTasks,
    summaryRows,
    periodText,
    departmentTitle = 'отдела разработки',
    watermarkUrl,
  }: BuildReportParams) {
    const allTasks = Object.values(groupedTasks)
      .flat()
      .sort((a, b) => {
        const aTime = new Date(a.movedTime ?? 0).getTime()
        const bTime = new Date(b.movedTime ?? 0).getTime()

        return bTime - aTime
      })

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

    const tasksHtml = allTasks
      .map((task, index) => {
        const description = this.escapeHtml(
          String(task[TaskCodes.description] ?? ''),
        )

        const result = this.escapeHtml(String(task[TaskCodes.result] ?? ''))

        const estimateTime =
          typeof Number(task[TaskCodes.estimateTime]) === 'number' &&
          Number(task[TaskCodes.estimateTime]) > 0
            ? `${this.escapeHtml(String(task[TaskCodes.estimateTime]))} ч.`
            : null

        return `
          <div class="task-entry">
            <div class="task-line">
              <span class="task-line-number">${index + 1}.</span>
              <span class="task-line-title">${this.escapeHtml(task.title ?? '')}</span>
              <span class="task-line-title">${'Затрачено:'}${estimateTime}</span>
               
            </div>

            ${
              description
                ? `
                  <div class="task-description">
                    ${description}
                  </div>
                `
                : ''
            }
               <div class="task-line">
              <span class="task-line-title">${'Результат:'}</span>
              </div>
             ${
               result
                 ? `
                  <div class="task-description">
                    ${result}
                  </div>
                `
                 : ''
             }

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

            .top-brand-title {
              font-size: 22px;
              font-weight: 700;
              line-height: 1.25;
              margin: 0;
              color: rgb(60, 134, 140);
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

            .task-entry {
              margin-bottom: 14px;
              break-inside: avoid;
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
              font-style: italic;
            }

            .task-meta-label {
              font-weight: 700;
            }

            .task-description {
              margin: 6px 0 0 24px;
              text-align: justify;
              white-space: normal;
              word-break: break-word;
                break-inside: avoid;
              page-break-inside: avoid;
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
              <h1 class="top-brand-title">
                Отчет по задачам ${this.escapeHtml(departmentTitle)}:
              </h1>
            </div>

            <ol class="section-list">
              <li>
                <div class="section-title">Общие сведения</div>

                <ol class="sub-list">
                  <li>
                    <strong style="color: rgb(60, 134, 140)">
                      Период и назначение документа
                    </strong>
                    <p class="paragraph">
                      Документ отражает перечень задач ${this.escapeHtml(
                        departmentTitle.toLowerCase(),
                      )} за период
                      ${this.escapeHtml(periodText)},
                      сформированный на основании предоставленных заказчиком запросов.
                      <br /><br />
                      Статусы фактического закрытия задач, сроки завершения и комментарии
                      при необходимости уточняются отдельно.
                    </p>
                  </li>
                </ol>
              </li>


              
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

              <li>
                <div class="section-title">Перечень задач</div>
                ${tasksHtml || '<div class="empty">Нет данных за выбранный период</div>'}
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

  buildClientReportHtml({
    client,
    projects,
    periodText,
    watermarkUrl,
    summaryRows,
    commsData,
  }: BuildClientReportParams) {
    const renderCommList = (title: string, items: ReportProps[]) => {
      const listHtml = items.length
        ? items
            .map((report, index) => {
              const description = this.escapeHtml(
                String(report[DailyReportCodes.title] ?? ''),
              ).replace(/\n/g, '<br />')

              const spent = Number(report[DailyReportCodes.timeSpent])
              const spentText =
                Number.isFinite(spent) && spent > 0 ? `${spent} ч.` : ''

              return `
              <div class="comm-entry">
                <div class="comm-line">
                  <span>${index + 1}.</span>
               
    ${
      description
        ? `
                      <div class="comm-description">
                        ${description}
                        <span>${spentText}</span>
                      </div>
                    `
        : ''
    }
                </div>


              </div>
            `
            })
            .join('')
        : '<div class="empty">Нет отчетов</div>'

      return `
      <div class="comm-group">
        <div class="comm-group-title">${this.escapeHtml(title)}</div>
        ${listHtml}
      </div>
    `
    }

    const renderWeekBlock = ({
      title,
      start,
      end,
      spent,
      externalComms,
      internalComms,
    }: {
      title: string
      start: string
      end: string
      spent: number
      externalComms: ReportProps[]
      internalComms: ReportProps[]
    }) => {
      return `
      <div class="week-block">
        <h2 class="week-title">
          ${this.escapeHtml(title)} (${this.escapeHtml(start)} — ${this.escapeHtml(end)}) — ${spent} ч.
        </h2>

        ${renderCommList('External comms', externalComms)}
        ${renderCommList('Internal comms', internalComms)}
      </div>
    `
    }

    const commsHtml = commsData
      ? `
      <div class="comms-section">
        <h2 class="section-title">Коммуникации</h2>

        ${renderWeekBlock({
          title: 'Неделя 1',
          start: commsData.firstWeekComms.start,
          end: commsData.firstWeekComms.end,
          spent: commsData.firstWeekComms.spent,
          externalComms: commsData.firstWeekComms.externalComms,
          internalComms: commsData.firstWeekComms.internalComms,
        })}

        ${renderWeekBlock({
          title: 'Неделя 2',
          start: commsData.secondWeekComms.start,
          end: commsData.secondWeekComms.end,
          spent: commsData.secondWeekComms.spent,
          externalComms: commsData.secondWeekComms.externalComms,
          internalComms: commsData.secondWeekComms.internalComms,
        })}
      </div>
    `
      : ''

    const summaryBlock = summaryRows?.length
      ? `
      <table class="summary-table">
        <thead>
          <tr>
            <th>Показатель</th>
            <th>Значение</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows
            .map(
              (row) => `
                <tr>
                  <td>${row.label}</td>
                  <td>${row.value}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    `
      : ''

    const projectsHtml = projects
      .toSorted((a, b) => b.tasks.length - a.tasks.length)
      .map(({ project, tasks }) => {
        const projectEstimateTime = tasks.reduce((sum, task) => {
          const value = Number(task[TaskCodes.estimateTime])
          return sum + (Number.isFinite(value) ? value : 0)
        }, 0)

        const tasksHtml = tasks
          .map((task, index) => {
            const description = this.escapeHtml(
              String(task[TaskCodes.description] ?? ''),
            ).replace(/\n/g, '<br />')

            const result = this.escapeHtml(String(task.result ?? '')).replace(
              /\n+/g,
              '<br />',
            )

            const estimateTime =
              Number(task[TaskCodes.estimateTime]) > 0
                ? `${task[TaskCodes.estimateTime]} ч.`
                : ''

            return `
            <div class="task-entry">
              <div class="task-line">
                <span>${index + 1}.</span>
                <span>${this.escapeHtml(task.title ?? '')}</span>
                <span>${estimateTime}</span>
              </div>

              ${
                description
                  ? `
                    <div class="task-description">
                      ${description}
                    </div>
                  `
                  : ''
              }

              ${
                result
                  ? `
                    <div class="task-result">
                      <div class="task-result-title">Результат:</div>
                      <div class="task-result-text">${result}</div>
                    </div>
                  `
                  : ''
              }
            </div>
          `
          })
          .join('')

        return `
        <div class="project-block">
          <h2 class="project-title">
            ${this.escapeHtml(project.title ?? 'Без названия')}
            (${projectEstimateTime} ч.)
          </h2>

          ${tasksHtml || '<div class="empty">Нет задач</div>'}
        </div>
      `
      })
      .join('')

    return `
    <html>
      <head>
        <style>
          body {
            font-family: Arial;
            font-size: 13px;
          }

          .summary-table {
            width: 100%;
            border-collapse: collapse;
            margin: 0 0 20px 0;
          }

          .summary-table th,
          .summary-table td {
            border: 1px solid #ccc;
            padding: 8px;
            text-align: left;
            vertical-align: top;
          }

          .summary-table th {
            background: rgb(60, 134, 140);
            color: #fff;
          }

          .section-title {
            margin: 24px 0 12px;
          }

          .week-block {
            margin-bottom: 24px;
          }

          .week-title {
            margin: 0 0 10px 0;
            break-after: avoid;
            page-break-after: avoid;
          }

          .comm-group {
            margin: 0 0 16px 16px;
          }

          .comm-group-title {
            font-weight: 700;
            margin-bottom: 8px;
          }

          .comm-entry {
            margin-left: 16px;
            margin-bottom: 10px;
          }

          .comm-line {
            font-weight: bold;
            display: flex;
            gap: 8px;
          }

          .comm-description {
            margin-left: 16px;
          }

          .project-block {
            margin-bottom: 24px;
          }

          .project-title {
            margin: 0 0 12px 0;
            break-after: avoid;
            page-break-after: avoid;
          }

          .task-entry {
            margin-left: 16px;
            margin-bottom: 10px;
          }

          .task-line {
            font-weight: bold;
            display: flex;
            gap: 8px;
          }

          .task-description {
            margin-left: 16px;
          }

          .task-result {
            margin-left: 16px;
            margin-top: 6px;
          }

          .task-result-title {
            font-weight: 700;
            margin-bottom: 2px;
          }

          .task-result-text {
            margin-left: 8px;
          }

          .empty {
            color: #888;
          }
        </style>
      </head>

      <body>
        ${watermarkUrl ? `<div class="watermark"></div>` : ''}

        <h1>Отчет по клиенту: ${this.escapeHtml(client.NAME)}</h1>

        <p>Период: ${this.escapeHtml(periodText)}</p>

        ${summaryBlock}
        ${commsHtml}
        ${projectsHtml}
      </body>
    </html>
  `
  }
}
