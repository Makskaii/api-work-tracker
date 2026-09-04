import { allocateSupportHours } from './support-hours-allocation'

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
