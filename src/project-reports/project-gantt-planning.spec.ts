import { BadRequestException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateProjectGanttStageDto } from './dto/create-project-gantt-stage.dto'
import { UpdateProjectGanttStageDto } from './dto/update-project-gantt-stage.dto'
import { ProjectGanttService } from './project-gantt.service'
import { ProjectGanttGroupStatus, ProjectGanttStage, ProjectGanttStageType } from './entities/project-gantt-stage.entity'

function fixture(isGroup = false) {
  const stage = {
    id: 7, projectId: '31', title: 'Custom stage', code: 'development-2',
    isGroup, parentStageId: isGroup ? null : 5, stageType: ProjectGanttStageType.Development,
    groupStatus: ProjectGanttGroupStatus.InProgress, plannedHours: 20,
    dependsOnStageId: null, dependencyAnchor: null, durationDays: null, sortOrder: 0,
  } as ProjectGanttStage
  const stages = {
    findOne: jest.fn().mockResolvedValue(stage),
    save: jest.fn((value: ProjectGanttStage) => Promise.resolve(value)),
    update: jest.fn(),
  }
  const events = { findOne: jest.fn(), save: jest.fn(), update: jest.fn(), delete: jest.fn() }
  const payments = { save: jest.fn(), update: jest.fn(), delete: jest.fn() }
  const service = new ProjectGanttService(stages as never, events as never, payments as never)
  return { stage, stages, events, payments, service }
}

describe('Gantt planned hours validation', () => {
  it.each([null, 0, 0.25, 5, 20.5, 1000000])('accepts explicit hours %p', async (plannedHours) => {
    for (const Dto of [CreateProjectGanttStageDto, UpdateProjectGanttStageDto]) {
      expect(await validate(plainToInstance(Dto, { plannedHours }))).toHaveLength(0)
    }
  })
  it.each([-1, 0.001, NaN, Infinity, 1000001, '', '5', '5,5', true])('rejects invalid hours %p', async (plannedHours) => {
    for (const Dto of [CreateProjectGanttStageDto, UpdateProjectGanttStageDto]) {
      expect((await validate(plainToInstance(Dto, { plannedHours }))).some((error) => error.property === 'plannedHours')).toBe(true)
    }
  })
  it('keeps an omitted estimate distinct from zero', async () => {
    const dto = plainToInstance(CreateProjectGanttStageDto, {})
    expect(await validate(dto)).toHaveLength(0)
    expect(dto.plannedHours).toBeUndefined()
  })
  it('rejects a null completion status', async () => {
    const dto = plainToInstance(CreateProjectGanttStageDto, { groupStatus: null })
    expect((await validate(dto)).some((error) => error.property === 'groupStatus')).toBe(true)
  })
})

describe('manual stage/substage completion', () => {
  it.each([true, false])('permits independent completion (parent: %p) without touching events or payments', async (isGroup) => {
    const f = fixture(isGroup)
    const saved = await f.service.updateStage(7, { groupStatus: ProjectGanttGroupStatus.Completed })
    expect(saved.groupStatus).toBe(ProjectGanttGroupStatus.Completed)
    expect(saved.plannedHours).toBe(20)
    expect(f.events.findOne).not.toHaveBeenCalled()
    expect(f.events.save).not.toHaveBeenCalled()
    expect(f.payments.save).not.toHaveBeenCalled()
    expect(f.stages.update).not.toHaveBeenCalled()
    expect(f.stages.save).toHaveBeenCalledTimes(1)
  })
  it('can reopen a completed substage without changing its parent or dates', async () => {
    const f = fixture()
    f.stage.groupStatus = ProjectGanttGroupStatus.Completed
    const saved = await f.service.updateStage(7, { groupStatus: ProjectGanttGroupStatus.InProgress })
    expect(saved.groupStatus).toBe(ProjectGanttGroupStatus.InProgress)
    expect(saved.parentStageId).toBe(5)
    expect(f.events.save).not.toHaveBeenCalled()
  })
  it('persists a fractional estimate independently of duration', async () => {
    const f = fixture()
    const saved = await f.service.updateStage(7, { plannedHours: 12.25 })
    expect(saved.plannedHours).toBe(12.25)
    expect(saved.durationDays).toBeNull()
    expect(f.events.save).not.toHaveBeenCalled()
  })
  it('clears an estimate to null and accepts an explicit zero', async () => {
    const f = fixture()
    expect((await f.service.updateStage(7, { plannedHours: null })).plannedHours).toBeNull()
    expect((await f.service.updateStage(7, { plannedHours: 0 })).plannedHours).toBe(0)
  })
  it('does not require spent hours, dates or a matching budget to mark a stage completed', async () => {
    const f = fixture(true)
    expect((await f.service.updateStage(7, { plannedHours: 0, groupStatus: ProjectGanttGroupStatus.Completed })).groupStatus).toBe('completed')
  })
  it('rejects invalid hours even when called outside the HTTP DTO pipeline', async () => {
    const f = fixture()
    await expect(f.service.updateStage(7, { plannedHours: -1 })).rejects.toBeInstanceOf(BadRequestException)
    expect(f.stages.save).not.toHaveBeenCalled()
  })
  it('does not treat payments as work stages', async () => {
    const f = fixture()
    f.stage.code = 'payments'
    await expect(f.service.updateStage(7, { plannedHours: 5 })).rejects.toBeInstanceOf(BadRequestException)
    await expect(f.service.updateStage(7, { groupStatus: ProjectGanttGroupStatus.Completed })).rejects.toBeInstanceOf(BadRequestException)
  })
})
