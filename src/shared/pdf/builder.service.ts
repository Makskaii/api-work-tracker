import { Injectable } from '@nestjs/common'
import { TaskCodes } from 'src/constants/const'
import { GroupedTasksWithTimeSpent } from 'src/types/reports'

type BuildReportParams = {
  groupedTasks: GroupedTasksWithTimeSpent
  periodText: string
  departmentTitle?: string
  watermarkUrl?: string
}

@Injectable()
export class HtmlBuilderService {
  buildReportHtml({
    groupedTasks,
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

    const tasksHtml = allTasks
      .map((task, index) => {
        const description = this.escapeHtml(
          String(task[TaskCodes.description] ?? ''),
        ).replace(/\n/g, '<br />')

        const spent =
          typeof task.timeSpent === 'number' && task.timeSpent > 0
            ? `${this.escapeHtml(String(task.timeSpent))} ч.`
            : null

        return `
          <div class="task-entry">
            <div class="task-line">
              <span class="task-line-number">${index + 1}.</span>
              <span class="task-line-title">${this.escapeHtml(task.title ?? '')}</span>
            </div>

            ${
              spent
                ? `
                  <div class="task-meta">
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
}
