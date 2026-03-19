import { BadRequestException, Injectable } from '@nestjs/common'
import dayjs from 'dayjs'
import { DailyReportCodes } from 'src/constants/const'
import { UserInfo } from 'src/types/bitrix'
import { ReportProps } from 'src/types/reports'
import {
  ActivitiesMap,
  ActivityType,
  SprintEmployeeStatsResponse,
} from 'src/types/user-sprints'
import { BitrixService } from '../shared/integrations/bitrix/bitrix.service'

const FULL_SPRINT_AVAILABLE_TIME = 40
const HOURS_PER_DAY = 8

@Injectable()
export class UserSprintsService {
  constructor(private readonly bitrixService: BitrixService) {}

  async getSprintStatistics(
    userIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<SprintEmployeeStatsResponse[]> {
    if (!userIds.length) {
      return []
    }

    const uniqueUserIds = userIds

    const users = await this.bitrixService
      .getUsersByIds(uniqueUserIds)
      .catch((error) => {
        throw new BadRequestException()
      })

    const reportsByUsers = await Promise.all(
      uniqueUserIds.map((userId) =>
        this.bitrixService.getReportsByUser(userId, startDate, endDate),
      ),
    )

    const usersMap = new Map<string, UserInfo>()

    for (const user of users) {
      usersMap.set(user.id, user)
    }

    const availableTime = this.getAvailableTime(startDate)

    return uniqueUserIds.map((userId, index): SprintEmployeeStatsResponse => {
      const reports = reportsByUsers[index] ?? []
      const activitiesMap = this.groupTimeByActivity(reports)
      const timeSpent = this.calculateTotalTime(activitiesMap)
      const effectivityValue = this.calculateEffectivity(
        availableTime,
        timeSpent,
      )

      return {
        id: String(userId),
        title: this.getUserTitle(usersMap.get(String(userId)), userId),
        availableTime,
        [ActivityType.development]: activitiesMap[ActivityType.development],
        [ActivityType.clientCall]: activitiesMap[ActivityType.clientCall],
        [ActivityType.analitycsCall]: activitiesMap[ActivityType.analitycsCall],
        [ActivityType.dash]: activitiesMap[ActivityType.dash],
        [ActivityType.devsCall]: activitiesMap[ActivityType.devsCall],
        timeSpent,
        effectivity: `${effectivityValue}%`,
        comment: this.getCommentByEffectivity(effectivityValue),
      }
    })
  }

  private getSprintBorders(date: Date): {
    startOfTheWeek: string
    endOfTheWeek: string
  } {
    const dayjsDate = dayjs(date)
    const currentDay = dayjsDate.day()

    const startOfSprint = currentDay >= 2 ? dayjsDate.day(2) : dayjsDate.day(-5)

    const endOfSprint = startOfSprint.add(6, 'day')

    return {
      startOfTheWeek: startOfSprint.format('YYYY-MM-DD'),
      endOfTheWeek: endOfSprint.format('YYYY-MM-DD'),
    }
  }

  private getAvailableTime(startOfTheWeek: string): number {
    const currWeekBorders = this.getSprintBorders(new Date())

    const currWeekStart = dayjs(currWeekBorders.startOfTheWeek)
      .subtract(1, 'day')
      .format('YYYY-MM-DD')

    const day = dayjs().day()

    return dayjs(startOfTheWeek).isBefore(dayjs(currWeekStart), 'day')
      ? FULL_SPRINT_AVAILABLE_TIME
      : day * HOURS_PER_DAY
  }

  private createEmptyActivitiesMap(): ActivitiesMap {
    return {
      [ActivityType.development]: 0,
      [ActivityType.clientCall]: 0,
      [ActivityType.analitycsCall]: 0,
      [ActivityType.dash]: 0,
      [ActivityType.devsCall]: 0,
    }
  }

  private parseSpentTime(value: unknown): number {
    if (typeof value === 'number') {
      return value
    }

    if (typeof value === 'string') {
      const normalized = value.replace(',', '.').trim()
      const parsed = Number(normalized)

      return Number.isFinite(parsed) ? parsed : 0
    }

    return 0
  }

  private groupTimeByActivity(reports: ReportProps[]): ActivitiesMap {
    const activitiesMap = this.createEmptyActivitiesMap()

    for (const report of reports) {
      const activityType = Number(
        report[DailyReportCodes.activityType] ?? 0,
      ) as ActivityType

      const timeSpent = this.parseSpentTime(report[DailyReportCodes.timeSpent])

      if (!activityType || !(activityType in activitiesMap)) {
        continue
      }

      activitiesMap[activityType] += timeSpent
    }

    return activitiesMap
  }

  private calculateTotalTime(activitiesMap: ActivitiesMap): number {
    return Object.values(activitiesMap).reduce((acc, value) => acc + value, 0)
  }

  private calculateEffectivity(
    availableTime: number,
    timeSpent: number,
  ): number {
    if (!availableTime) {
      return 0
    }

    return Math.round((timeSpent / availableTime) * 100)
  }

  private getCommentByEffectivity(effectivity: number): string {
    if (effectivity > 100) {
      return 'Перегрузка'
    }

    if (effectivity < 100) {
      return 'Недогрузка'
    }

    return 'Норма'
  }

  private getUserTitle(
    user: UserInfo | undefined,
    fallbackUserId: number,
  ): string {
    if (!user?.title) {
      return `Пользователь ${fallbackUserId}`
    }

    return user.title
  }
}
