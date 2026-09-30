import { BadRequestException } from '@nestjs/common'
import { ProjectGanttEvent, ProjectGanttEventKind } from './entities/project-gantt-event.entity'
import { ProjectGanttService } from './project-gantt.service'

function fixture() {
  const event = {
    id: 1,
    projectId: '31',
    stageId: 7,
    title: 'Разработка',
    eventKind: ProjectGanttEventKind.Duration,
    planStartDate: '2026-09-01',
    planEndDate: '2026-09-05',
    factStartDate: '2026-09-02',
    factEndDate: '2026-09-06',
    sortOrder: 0,
  } as ProjectGanttEvent
  const events = {
    findOne: jest.fn().mockResolvedValue(event),
    save: jest.fn((value: ProjectGanttEvent) => Promise.resolve(value)),
  }
  const payments = { save: jest.fn(), update: jest.fn() }
  const service = new ProjectGanttService({} as never, events as never, payments as never)
  return { service, event, events, payments }
}

describe('Gantt event date edits', () => {
  it.each(['planStartDate', 'planEndDate'] as const)('rejects clearing only %s from a planned interval', async (field) => {
    const f = fixture()
    await expect(f.service.updateEvent(1, { [field]: null })).rejects.toBeInstanceOf(BadRequestException)
    expect(f.events.save).not.toHaveBeenCalled()
    expect(f.event.planStartDate).toBe('2026-09-01')
    expect(f.event.planEndDate).toBe('2026-09-05')
  })

  it('allows clearing an entire planned interval without losing legacy fact dates', async () => {
    const f = fixture()
    expect(await f.service.updateEvent(1, { planStartDate: null, planEndDate: null })).toMatchObject({
      planStartDate: null,
      planEndDate: null,
      factStartDate: '2026-09-02',
      factEndDate: '2026-09-06',
    })
    expect(f.payments.save).not.toHaveBeenCalled()
    expect(f.payments.update).not.toHaveBeenCalled()
  })

  it('validates a conversion to a milestone against the explicitly cleared end date', async () => {
    const f = fixture()
    expect(await f.service.updateEvent(1, {
      eventKind: ProjectGanttEventKind.OneTime,
      planStartDate: '2026-09-10',
      planEndDate: null,
    })).toMatchObject({
      eventKind: ProjectGanttEventKind.OneTime,
      planStartDate: '2026-09-10',
      planEndDate: null,
    })
  })

  it('still checks a new start date against the end date when the end is omitted', async () => {
    const f = fixture()
    await expect(f.service.updateEvent(1, { planStartDate: '2026-09-10' })).rejects.toBeInstanceOf(BadRequestException)
    expect(f.events.save).not.toHaveBeenCalled()
  })

  it('allows reopening a legacy fact interval by explicitly clearing its end', async () => {
    const f = fixture()
    expect(await f.service.updateEvent(1, { factStartDate: '2026-09-10', factEndDate: null })).toMatchObject({
      factStartDate: '2026-09-10',
      factEndDate: null,
      planStartDate: '2026-09-01',
      planEndDate: '2026-09-05',
    })
  })
})
