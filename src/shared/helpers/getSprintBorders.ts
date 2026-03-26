import dayjs, { Dayjs } from 'dayjs'

export const getSprintBorders = (
  date: Date | Dayjs,
): {
  startOfTheWeek: string
  endOfTheWeek: string
} => {
  const dayjsDate = dayjs(date)
  const currentDay = dayjsDate.day()

  const startOfSprint = currentDay >= 2 ? dayjsDate.day(2) : dayjsDate.day(-5)

  const endOfSprint = startOfSprint.add(6, 'day')

  return {
    startOfTheWeek: startOfSprint.format('YYYY-MM-DD'),
    endOfTheWeek: endOfSprint.format('YYYY-MM-DD'),
  }
}
