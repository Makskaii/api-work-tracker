import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import dayjs, { Dayjs } from 'dayjs'
import { EntityTypeIds, TaskCodes } from 'src/constants/const'
import { getSprintBorders } from 'src/shared/helpers/getSprintBorders'
import { BitrixService } from 'src/shared/integrations/bitrix/bitrix.service'
import { TaskProps } from 'src/types/tasks'
import { Repository } from 'typeorm'
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

      lastSyncedAt: new Date(),
      raw: task,
    }
  }

  async syncTasks() {
    const today = dayjs()
    const borders = getSprintBorders(today)

    const sprintStartDate = dayjs(borders.startOfTheWeek).format('YYYY-MM-DD')
    const sprintEndDate = dayjs(borders.endOfTheWeek).format('YYYY-MM-DD')
    const sprintCode = `${sprintStartDate}_${sprintEndDate}`

    try {
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

      if (!snapshots.length) {
        this.logger.log(`No tasks found for sprint ${sprintCode}`)

        return {
          sprintCode,
          totalFetched: tasks.length,
          includedInSprint: 0,
          upserted: 0,
        }
      }

      this.logger.log(`Fetched tasks: ${tasks.length}`)
      this.logger.log(`Filtered tasks: ${tasks.length}`)
      this.logger.log(
        `Snapshots: ${JSON.stringify(snapshots.slice(0, 2), null, 2)}`,
      )

      await this.sprintTaskSnapshotRepository.upsert(snapshots, {
        conflictPaths: ['sprintCode', 'taskId'],
        skipUpdateIfNoValuesChanged: true,
      })

      this.logger.log(
        `Sprint sync completed: sprint=${sprintCode}, fetched=${tasks.length}, included=${tasks.length}`,
      )

      return {
        sprintCode,
        totalFetched: tasks.length,
        includedInSprint: tasks.length,
        upserted: snapshots.length,
      }
    } catch (error) {
      console.log(error)
    }
  }

  async getCurrentSprintTasks() {
    const today = dayjs()
    const borders = getSprintBorders(today)

    const sprintStartDate = dayjs(borders.startOfTheWeek).format('YYYY-MM-DD')
    const sprintEndDate = dayjs(borders.endOfTheWeek).format('YYYY-MM-DD')
    const sprintCode = `${sprintStartDate}_${sprintEndDate}`

    const tasks = await this.sprintTaskSnapshotRepository.find({
      where: { sprintCode },
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
}
