import { allocateProjectSupportHours, allocateSupportHours } from './support-hours-allocation'

describe('allocateSupportHours', () => {
  it('uses the earliest package with an available balance first', () => {
    expect(allocateSupportHours([
      { id: 1, purchasedHours: 10, consumedHours: 8 },
      { id: 2, purchasedHours: 20, consumedHours: 0 },
    ], 5)).toEqual([
      { packageId: 1, hours: 2 },
      { packageId: 2, hours: 3 },
    ])
  })

  it('records the overrun on the latest package', () => {
    expect(allocateSupportHours([
      { id: 1, purchasedHours: 10, consumedHours: 9 },
    ], 3)).toEqual([
      { packageId: 1, hours: 3 },
    ])
  })

  it('does not allocate zero or invalid hours', () => {
    expect(allocateSupportHours([{ id: 1, purchasedHours: 10, consumedHours: 0 }], 0)).toEqual([])
  })
})

describe('allocateProjectSupportHours', () => {
  const report = (id: number, hours: number, bitrixTaskId: string | null = null) => ({ id, bitrixReportId: String(id), bitrixTaskId, hours })

  it('keeps legacy FIFO and overrun for reports without manual rules', () => {
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 3 }, { id: 2, purchasedHours: 4 }], [report(1, 4), report(2, 5)])).toEqual([
      { reportId: 1, packageId: 1, hours: 3 }, { reportId: 1, packageId: 2, hours: 1 }, { reportId: 2, packageId: 2, hours: 5 },
    ])
  })

  it('caps a manually assigned five-hour report at three available hours and leaves two unallocated', () => {
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 3 }], [report(1, 5)], [{ bitrixReportId: '1', allocations: [{ packageId: 1, hours: 5 }] }])).toEqual([
      { reportId: 1, packageId: 1, hours: 3 },
    ])
  })

  it('reserves explicit assignments before earlier automatic reports', () => {
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 5 }, { id: 2, purchasedHours: 10 }], [report(1, 5), report(2, 3)], [
      { bitrixReportId: '2', allocations: [{ packageId: 1, hours: 3 }] },
    ])).toEqual([
      { reportId: 1, packageId: 1, hours: 2 }, { reportId: 1, packageId: 2, hours: 3 }, { reportId: 2, packageId: 1, hours: 3 },
    ])
  })

  it('does not return an explicitly unallocated report to FIFO or its task target', () => {
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 10 }], [report(1, 3, '100')], [{ bitrixReportId: '1', allocations: [] }], [{ bitrixTaskId: '100', packageId: 1 }])).toEqual([])
  })

  it('inherits a task target for future reports, caps them and gives explicit reports precedence', () => {
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 4 }, { id: 2, purchasedHours: 10 }], [report(1, 3, '100'), report(2, 3, '100'), report(3, 2, '100')], [
      { bitrixReportId: '3', allocations: [{ packageId: 2, hours: 2 }] },
    ], [{ bitrixTaskId: '100', packageId: 1 }])).toEqual([
      { reportId: 1, packageId: 1, hours: 3 }, { reportId: 2, packageId: 1, hours: 1 }, { reportId: 3, packageId: 2, hours: 2 },
    ])
  })

  it('keeps task work unallocated after its package is deleted or deliberately cleared', () => {
    for (const packageId of [null, 999]) {
      expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 10 }], [report(1, 3, '100')], [], [{ bitrixTaskId: '100', packageId }])).toEqual([])
    }
  })

  it('keeps manual portions referencing a deleted package unallocated', () => {
    expect(allocateProjectSupportHours([{ id: 2, purchasedHours: 10 }], [report(1, 5)], [{
      bitrixReportId: '1', allocations: [{ packageId: 1, hours: 3 }, { packageId: 2, hours: 2 }],
    }])).toEqual([{ reportId: 1, packageId: 2, hours: 2 }])
  })

  it('never allocates more than the current report hours when the source report is reduced', () => {
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 10 }, { id: 2, purchasedHours: 10 }], [report(1, 3)], [{
      bitrixReportId: '1', allocations: [{ packageId: 1, hours: 2 }, { packageId: 2, hours: 3 }],
    }])).toEqual([{ reportId: 1, packageId: 1, hours: 2 }, { reportId: 1, packageId: 2, hours: 1 }])
  })

  it('leaves increased report hours unallocated instead of expanding a stored manual decision', () => {
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 10 }], [report(1, 7)], [{
      bitrixReportId: '1', allocations: [{ packageId: 1, hours: 3 }],
    }])).toEqual([{ reportId: 1, packageId: 1, hours: 3 }])
  })

  it('uses exact hundredths across fractional splits and combines duplicate package portions', () => {
    const result = allocateProjectSupportHours([{ id: 1, purchasedHours: 0.3 }, { id: 2, purchasedHours: 1 }], [report(1, 0.4)], [{
      bitrixReportId: '1', allocations: [{ packageId: 1, hours: 0.1 }, { packageId: 1, hours: 0.2 }, { packageId: 2, hours: 0.1 }],
    }])
    expect(result).toEqual([{ reportId: 1, packageId: 1, hours: 0.3 }, { reportId: 1, packageId: 2, hours: 0.1 }])
  })

  it('leaves all work unallocated without packages and ignores rules for absent or excluded reports', () => {
    const assignments = [{ bitrixReportId: '1', allocations: [{ packageId: 1, hours: 3 }] }]
    expect(allocateProjectSupportHours([], [report(1, 3)], assignments)).toEqual([])
    expect(allocateProjectSupportHours([{ id: 1, purchasedHours: 10 }], [report(2, 2)], assignments)).toEqual([{ reportId: 2, packageId: 1, hours: 2 }])
  })

  it('does not mutate persisted rules or inputs while respecting supplied FIFO order', () => {
    const packages = [{ id: 2, purchasedHours: 3 }, { id: 1, purchasedHours: 3 }]
    const reports = [report(2, 2, '100'), report(1, 2, '100')]
    const assignments = [{ bitrixReportId: '1', allocations: [{ packageId: 1, hours: 2 }] }]
    const tasks = [{ bitrixTaskId: '100', packageId: 2 }]
    const before = JSON.stringify({ packages, reports, assignments, tasks })
    expect(allocateProjectSupportHours(packages, reports, assignments, tasks)).toEqual([{ reportId: 2, packageId: 2, hours: 2 }, { reportId: 1, packageId: 1, hours: 2 }])
    expect(JSON.stringify({ packages, reports, assignments, tasks })).toBe(before)
  })
})
