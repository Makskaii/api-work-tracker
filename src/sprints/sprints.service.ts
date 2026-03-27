import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import dayjs, { Dayjs } from 'dayjs'
import { EntityTypeIds, TaskCodes } from 'src/constants/const'
import { getSprintBorders } from 'src/shared/helpers/getSprintBorders'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { TaskProps } from 'src/types/tasks'
import { Not, Repository } from 'typeorm'
import { SprintTaskSnapshot } from './entities/sprint-task-snapshot.entity'

@Injectable()
export class SprintsService {
  private readonly logger = new Logger(SprintsService.name)

  constructor(
    private readonly bitrixService: BitrixService,
    @InjectRepository(SprintTaskSnapshot)
    private readonly sprintTaskSnapshotRepository: Repository<SprintTaskSnapshot>,
  ) {}

  private readonly DONE_STAGE_ID = 'DT1072_18:UC_6JNSDG'

  private isCompletedTask(task: TaskProps) {
    return task.stageId === this.DONE_STAGE_ID
  }

  private isOverdueTask(
    task: TaskProps,
    today: Dayjs | string,
    sprintEnd: string | Dayjs,
  ) {
    return (
      dayjs(today).isAfter(sprintEnd) && task.stageId !== this.DONE_STAGE_ID
    )
  }

  private getCurrentSprintMeta(date: Date | Dayjs = new Date()) {
    const today = dayjs(date)
    const borders = getSprintBorders(today)

    const sprintStartDate = dayjs(borders.startOfTheWeek).format('YYYY-MM-DD')
    const sprintEndDate = dayjs(borders.endOfTheWeek).format('YYYY-MM-DD')
    const sprintCode = `${sprintStartDate}_${sprintEndDate}`

    return {
      today,
      borders,
      sprintStartDate,
      sprintEndDate,
      sprintCode,
    }
  }

  private mapTaskToSnapshot(
    task: TaskProps,
    sprintCode: string,
    sprintStartDate: string,
    sprintEndDate: string,
    today: Dayjs,
  ): Partial<SprintTaskSnapshot> {
    return {
      sprintCode,
      sprintStartDate,
      sprintEndDate,
      taskId: Number(task.id),
      title: task.title ?? '',
      description: task[TaskCodes.description] ?? null,

      employeeId: task.assignedById ? Number(task.assignedById) : null,
      employeeName: null,

      projectId: task[TaskCodes.project]
        ? Number(task[TaskCodes.project])
        : null,
      projectName: null,

      clientId: task[TaskCodes.client] ? Number(task[TaskCodes.client]) : null,
      clientName: null,

      stageId: task.stageId ?? null,
      stageName: null,

      isCompleted: this.isCompletedTask(task),
      isOverdue: this.isOverdueTask(task, today, sprintEndDate),

      addedDuringSprint: false,
      removedDuringSprint: false,

      estimatedHours: String(task[TaskCodes.estimateTime] ?? 0),
      spentHours: '0',

      sprintDateStart: Array.isArray(task[TaskCodes.sprintDateStart])
        ? task[TaskCodes.sprintDateStart]
        : null,

      taskCreatedAt: task.createdTime ? new Date(task.createdTime) : null,
      taskUpdatedAt: task.updatedTime ? new Date(task.updatedTime) : null,
      movedAt: task.movedTime ? new Date(task.movedTime) : null,
      closedAt: null,

      isActive: true,
      lastSyncedAt: new Date(),
      raw: task,
    }
  }

  private async deactivateMissingTasks(
    sprintCode: string,
    actualTaskIds: number[],
  ) {
    if (!actualTaskIds.length) {
      await this.sprintTaskSnapshotRepository
        .createQueryBuilder()
        .update(SprintTaskSnapshot)
        .set({
          isActive: false,
          lastSyncedAt: new Date(),
        })
        .where('sprintCode = :sprintCode', { sprintCode })
        .andWhere('isActive = true')
        .execute()

      return
    }

    await this.sprintTaskSnapshotRepository
      .createQueryBuilder()
      .update(SprintTaskSnapshot)
      .set({
        isActive: false,
        lastSyncedAt: new Date(),
      })
      .where('sprintCode = :sprintCode', { sprintCode })
      .andWhere('taskId NOT IN (:...actualTaskIds)', { actualTaskIds })
      .andWhere('isActive = true')
      .execute()
  }

  async syncTasks() {
    const { today, borders, sprintStartDate, sprintEndDate, sprintCode } =
      this.getCurrentSprintMeta()

    const tasks = await this.bitrixService.listItems<TaskProps>({
      entityTypeId: EntityTypeIds.tasks,
      select: [
        'id',
        'title',
        'stageId',
        'assignedById',
        'createdTime',
        'updatedTime',
        'movedTime',
        TaskCodes.description,
        TaskCodes.project,
        TaskCodes.client,
        TaskCodes.estimateTime,
        TaskCodes.sprintDateStart,
      ],
      filter: {
        [`>=${TaskCodes.sprintDateStart}`]: borders.startOfTheWeek,
        [`<=${TaskCodes.sprintDateStart}`]: borders.endOfTheWeek,
      },
    })

    const snapshots = tasks.map((task) =>
      this.mapTaskToSnapshot(
        task,
        sprintCode,
        sprintStartDate,
        sprintEndDate,
        today,
      ),
    )

    const actualTaskIds = snapshots
      .map((item) => Number(item.taskId))
      .filter((id) => !Number.isNaN(id))

    if (snapshots.length) {
      await this.sprintTaskSnapshotRepository.upsert(snapshots, {
        conflictPaths: ['sprintCode', 'taskId'],
        skipUpdateIfNoValuesChanged: true,
      })
    }

    await this.deactivateMissingTasks(sprintCode, actualTaskIds)

    this.logger.log(
      `Sprint sync completed: sprint=${sprintCode}, fetched=${tasks.length}, active=${actualTaskIds.length}`,
    )

    return {
      sprintCode,
      totalFetched: tasks.length,
      includedInSprint: tasks.length,
      upserted: snapshots.length,
      deactivatedChecked: true,
    }
  }

  async getCurrentSprintTasks() {
    const { sprintCode } = this.getCurrentSprintMeta()

    const tasks = await this.sprintTaskSnapshotRepository.find({
      where: { sprintCode },
      order: {
        isActive: 'DESC',
        updatedAt: 'DESC',
      },
    })

    return {
      sprintCode,
      count: tasks.length,
      items: tasks,
    }
  }

  async getCurrentActiveSprintTasks() {
    const { sprintCode } = this.getCurrentSprintMeta()

    const tasks = await this.sprintTaskSnapshotRepository.find({
      where: {
        sprintCode,
        isActive: true,
      },
      order: {
        updatedAt: 'DESC',
      },
    })

    return {
      sprintCode,
      count: tasks.length,
      items: tasks,
    }
  }

  async getCurrentSprintDeveloperStats() {
    const { sprintCode } = this.getCurrentSprintMeta()

    const tasks = await this.sprintTaskSnapshotRepository.find({
      where: { sprintCode },
      order: {
        isActive: 'DESC',
        updatedAt: 'DESC',
      },
    })

    const grouped = new Map<
      string,
      {
        employeeId: number | null
        employeeName: string | null

        summaryActive: {
          tasksTotal: number
          completedTasks: number
          notCompletedTasks: number
          overdueTasks: number
          estimatedHoursSum: number
        }

        summaryInactive: {
          tasksTotal: number
          completedTasks: number
          notCompletedTasks: number
          overdueTasks: number
          estimatedHoursSum: number
        }

        tasksByProjectActiveMap: Map<
          string,
          {
            projectId: number | null
            projectName: string | null
            count: number
            completedTasks: number
            taskIds: number[]
          }
        >

        activeItems: SprintTaskSnapshot[]
        inactiveItems: SprintTaskSnapshot[]
      }
    >()

    for (const task of tasks) {
      const key = String(task.employeeId ?? 'unknown')

      if (!grouped.has(key)) {
        grouped.set(key, {
          employeeId: task.employeeId ?? null,
          employeeName: task.employeeName ?? null,

          summaryActive: {
            tasksTotal: 0,
            completedTasks: 0,
            notCompletedTasks: 0,
            overdueTasks: 0,
            estimatedHoursSum: 0,
          },

          summaryInactive: {
            tasksTotal: 0,
            completedTasks: 0,
            notCompletedTasks: 0,
            overdueTasks: 0,
            estimatedHoursSum: 0,
          },

          tasksByProjectActiveMap: new Map(),
          activeItems: [],
          inactiveItems: [],
        })
      }

      const stat = grouped.get(key)!

      if (task.isActive) {
        stat.summaryActive.tasksTotal += 1
        stat.summaryActive.estimatedHoursSum += Number(task.estimatedHours ?? 0)

        if (task.isCompleted) {
          stat.summaryActive.completedTasks += 1
        } else {
          stat.summaryActive.notCompletedTasks += 1
        }

        if (task.isOverdue) {
          stat.summaryActive.overdueTasks += 1
        }

        const projectKey = String(task.projectId ?? 'unknown')
        const existingProject = stat.tasksByProjectActiveMap.get(projectKey)

        if (existingProject) {
          existingProject.count += 1
          existingProject.taskIds.push(Number(task.taskId))

          if (task.isCompleted) {
            existingProject.completedTasks += 1
          }
        } else {
          stat.tasksByProjectActiveMap.set(projectKey, {
            projectId: task.projectId ?? null,
            projectName: task.projectName ?? null,
            count: 1,
            completedTasks: task.isCompleted ? 1 : 0,
            taskIds: [Number(task.taskId)],
          })
        }

        stat.activeItems.push(task)
      } else {
        stat.summaryInactive.tasksTotal += 1
        stat.summaryInactive.estimatedHoursSum += Number(
          task.estimatedHours ?? 0,
        )

        if (task.isCompleted) {
          stat.summaryInactive.completedTasks += 1
        } else {
          stat.summaryInactive.notCompletedTasks += 1
        }

        if (task.isOverdue) {
          stat.summaryInactive.overdueTasks += 1
        }

        stat.inactiveItems.push(task)
      }
    }

    const items = Array.from(grouped.values()).map((stat) => ({
      employeeId: stat.employeeId,
      employeeName: stat.employeeName,

      summaryActive: {
        ...stat.summaryActive,
        estimatedHoursSum: Number(
          stat.summaryActive.estimatedHoursSum.toFixed(2),
        ),
      },

      summaryInactive: {
        ...stat.summaryInactive,
        estimatedHoursSum: Number(
          stat.summaryInactive.estimatedHoursSum.toFixed(2),
        ),
      },

      tasksByProjectActive: Array.from(
        stat.tasksByProjectActiveMap.values(),
      ).sort((a, b) => b.count - a.count),

      activeItems: stat.activeItems,
      inactiveItems: stat.inactiveItems,
    }))

    return {
      sprintCode,
      count: items.length,
      items,
    }
  }
}
