import { Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import { TaskCodes } from 'src/constants/const'
import { TaskProps } from 'src/types/tasks'

type GroupedTasks = Record<string, TaskProps[]>

@Injectable()
export class HtmlBuilderService {
  buildReportHtml(groupedTasks: GroupedTasks) {
    const sortedDates = Object.keys(groupedTasks).sort(
      (a, b) => dayjs(a).valueOf() - dayjs(b).valueOf(),
    )

    const content = sortedDates
      .map((date) => {
        const tasksHtml = groupedTasks[date]
          .map((task) => {
            const description = this.escapeHtml(
              task[TaskCodes.description] || '',
            ).replace(/\n/g, '<br />')

            return `
              <div class="task-item">
                <div class="task-title">${this.escapeHtml(task.title || '')}</div>
                <div class="task-description">${description}</div>
              </div>
            `
          })
          .join('')

        return `
          <section class="date-block">
            <h3 class="date-title">${dayjs(date).format('DD.MM.YYYY')}</h3>
            <div class="tasks-container">
              ${tasksHtml}
            </div>
          </section>
        `
      })
      .join('')

    return `
      <!DOCTYPE html>
      <html lang="ru">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Отчет по проекту</title>
          <style>
            * {
              box-sizing: border-box;
            }

            body {
              font-family: Arial, Helvetica, sans-serif;
              color: #222;
              padding: 24px;
              margin: 0;
              font-size: 14px;
              line-height: 1.5;
            }

            h1 {
              margin: 0 0 24px;
              font-size: 24px;
            }

            .date-block {
              margin-bottom: 24px;
              page-break-inside: avoid;
            }

            .date-title {
              margin: 0 0 10px;
              font-size: 18px;
            }

            .tasks-container {
              border: 1px solid #000;
              border-radius: 10px;
              padding: 10px;
            }

            .task-item {
              padding: 10px 0;
              border-bottom: 1px solid #ccc;
            }

            .task-item:last-child {
              border-bottom: none;
            }

            .task-title {
              font-weight: 700;
              margin-bottom: 6px;
            }

            .task-description {
              white-space: normal;
              word-break: break-word;
            }

            .empty {
              color: #777;
              font-style: italic;
            }
          </style>
        </head>
        <body>
          <h1>Отчет по проекту за 2 недели</h1>
          ${content || '<div class="empty">Нет данных за выбранный период</div>'}
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
