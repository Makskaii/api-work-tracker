import { BadGatewayException } from '@nestjs/common'
import {
  DailyReportCodes,
  EntityTypeIds,
  reportSelectFields,
} from '../constants/const'
import type { BitrixService } from '../shared/integrations/bitrix/bitrix.service'
import { SupportClientWorkReaderService } from './support-client-work-reader.service'

type BitrixWork = Record<string, unknown>
const now = new Date('2026-10-08T10:00:00Z')

function report(id: number, overrides: BitrixWork = {}): BitrixWork {
  return {
    id,
    title: `Отчёт №${id}`,
    begindate: '2026-10-01T12:00:00+03:00',
    [DailyReportCodes.parentId]: 100,
    [DailyReportCodes.timeSpent]: 2,
    [DailyReportCodes.title]: `Работа ${id}`,
    ...overrides,
  }
}

function setup() {
  const listAllItems = jest.fn().mockResolvedValue([])
  const reader = new SupportClientWorkReaderService({
    listAllItems,
  } as unknown as BitrixService)
  return { reader, listAllItems }
}

describe('Support client work history reader', () => {
  it('reads both historical task links without TP, package or project restrictions and deduplicates reports', async () => {
    const { reader, listAllItems } = setup()
    const excludedFromSupport = report(1, {
      [DailyReportCodes.includeInPackage]: false,
      [DailyReportCodes.project]: 900,
      [DailyReportCodes.parentproject]: 901,
      packageId: 999,
    })
    const legacy = report(2, {
      [DailyReportCodes.parentId]: undefined,
      [DailyReportCodes.taskId]: '101',
      [DailyReportCodes.includeInPackage]: false,
    })
    listAllItems
      .mockResolvedValueOnce([excludedFromSupport])
      .mockResolvedValueOnce([excludedFromSupport, legacy])

    const result = await reader.read(['100', '100', '00101'], now)

    expect(listAllItems).toHaveBeenNthCalledWith(1, {
      entityTypeId: EntityTypeIds.reports,
      filter: { [`@${DailyReportCodes.parentId}`]: ['100', '101'] },
      select: [...reportSelectFields],
    })
    expect(listAllItems).toHaveBeenNthCalledWith(2, {
      entityTypeId: EntityTypeIds.reports,
      filter: { [`@${DailyReportCodes.taskId}`]: ['100', '101'] },
      select: [...reportSelectFields],
    })
    expect(listAllItems).toHaveBeenCalledTimes(2)
    expect(result.map((item) => [item.taskId, item.row.id])).toEqual([
      ['100', '1'],
      ['101', '2'],
    ])
  })

  it('excludes foreign and missing task links even if the source API returns them', async () => {
    const { reader, listAllItems } = setup()
    listAllItems.mockResolvedValueOnce([
      report(1, { [DailyReportCodes.parentId]: 900 }),
      report(2, {
        [DailyReportCodes.parentId]: undefined,
        [DailyReportCodes.taskId]: undefined,
      }),
      report(3, {
        [DailyReportCodes.parentId]: 900,
        [DailyReportCodes.taskId]: 901,
      }),
      report(4, { id: 'not-an-id' }),
    ])
    expect(await reader.read(['100'], now)).toEqual([])
  })

  it.each([
    [100, 900],
    [900, 100],
  ])('rejects an ambiguous report linking task %s and task %s', async (parentId, customId) => {
    const { reader, listAllItems } = setup()
    listAllItems.mockResolvedValueOnce([
      report(1, {
        [DailyReportCodes.parentId]: parentId,
        [DailyReportCodes.taskId]: customId,
      }),
    ])
    await expect(reader.read(['100'], now)).rejects.toThrow(BadGatewayException)
  })

  it('accepts the same task in both fields and preserves localized actual hours and zero-hour work', async () => {
    const { reader, listAllItems } = setup()
    listAllItems.mockResolvedValueOnce([
      report(2, { [DailyReportCodes.timeSpent]: 0 }),
      report(1, {
        [DailyReportCodes.taskId]: '100',
        [DailyReportCodes.timeSpent]: ' 1,69 ',
      }),
    ])
    expect(await reader.read(['100'], now)).toEqual([
      {
        taskId: '100',
        row: {
          id: '1',
          date: '2026-10-01',
          hours: 1.69,
          description: 'Работа 1',
        },
      },
      {
        taskId: '100',
        row: { id: '2', date: '2026-10-01', hours: 0, description: 'Работа 2' },
      },
    ])
  })

  it('uses Moscow calendar days, includes the entire current day and excludes tomorrow', async () => {
    const { reader, listAllItems } = setup()
    listAllItems.mockResolvedValueOnce([
      report(1, { begindate: '2026-10-08T20:59:59Z' }),
      report(2, { begindate: '2026-10-08T21:00:00Z' }),
      report(3, { begindate: undefined, createdTime: '2026-10-07T21:00:00Z' }),
    ])
    expect(
      (await reader.read(['100'], now)).map((item) => [
        item.row.id,
        item.row.date,
      ]),
    ).toEqual([
      ['1', '2026-10-08'],
      ['3', '2026-10-08'],
    ])
  })

  it('keeps historical descriptions before the cabinet task cutoff or package purchase date', async () => {
    const { reader, listAllItems } = setup()
    listAllItems.mockResolvedValueOnce([
      report(1, {
        begindate: '2026-03-01T00:00:00+03:00',
        [DailyReportCodes.title]: '  Архивная работа  ',
      }),
    ])
    expect(await reader.read(['100'], now)).toEqual([
      {
        taskId: '100',
        row: {
          id: '1',
          date: '2026-03-01',
          hours: 2,
          description: 'Архивная работа',
        },
      },
    ])
  })

  it.each([
    -1,
    Number.POSITIVE_INFINITY,
    'not-hours',
  ])('rejects invalid hours %s instead of silently producing an incomplete PDF', async (hours) => {
    const { reader, listAllItems } = setup()
    listAllItems.mockResolvedValueOnce([
      report(1, { [DailyReportCodes.timeSpent]: hours }),
    ])
    await expect(reader.read(['100'], now)).rejects.toThrow(BadGatewayException)
  })

  it('propagates a source API failure rather than returning an empty history', async () => {
    const { reader, listAllItems } = setup()
    const failure = new Error('Bitrix history unavailable')
    listAllItems.mockRejectedValueOnce(failure)
    await expect(reader.read(['100'], now)).rejects.toBe(failure)
  })

  it('does not call Bitrix for an empty or invalid task list', async () => {
    const { reader, listAllItems } = setup()
    expect(await reader.read([], now)).toEqual([])
    expect(await reader.read(['0', '-1', 'not-an-id'], now)).toEqual([])
    expect(listAllItems).not.toHaveBeenCalled()
  })

  it('reads long company task lists in batches of at most 50 IDs for both link fields', async () => {
    const { reader, listAllItems } = setup()
    const ids = Array.from({ length: 51 }, (_, index) => String(100 + index))
    expect(await reader.read(ids, now)).toEqual([])
    expect(listAllItems).toHaveBeenCalledTimes(4)
    expect(listAllItems.mock.calls[0][0].filter).toEqual({
      [`@${DailyReportCodes.parentId}`]: ids.slice(0, 50),
    })
    expect(listAllItems.mock.calls[1][0].filter).toEqual({
      [`@${DailyReportCodes.taskId}`]: ids.slice(0, 50),
    })
    expect(listAllItems.mock.calls[2][0].filter).toEqual({
      [`@${DailyReportCodes.parentId}`]: ['150'],
    })
    expect(listAllItems.mock.calls[3][0].filter).toEqual({
      [`@${DailyReportCodes.taskId}`]: ['150'],
    })
  })
})
