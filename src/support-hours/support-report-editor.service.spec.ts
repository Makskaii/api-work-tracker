import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common'
import { validate } from 'class-validator'
import { DailyReportCodes, EntityTypeIds, ProjectCodes, REPORT_ACTIVITY_IBLOCK_ID, TaskCodes } from '../constants/const'
import { ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { PrepareSupportReportDto } from './dto/prepare-support-report.dto'
import { SupportReportEditorService } from './support-report-editor.service'

const now = new Date('2026-09-29T10:00:00Z')
const validDto = (changes: Partial<PrepareSupportReportDto> = {}): PrepareSupportReportDto => ({
  description: 'Исправлена загрузка документов', hours: 1.5, reportDate: '2026-09-29',
  includeInPackage: true, activityId: 3, ...changes,
})

function fixture() {
  const project = { id: 31, bitrixProjectId: '94', title: 'Техподдержка', projectType: ReportProjectType.Support }
  let liveProject: Record<string, unknown> | null = { id: 94, [ProjectCodes.company]: '215', [ProjectCodes.financialProjectType]: ['410'] }
  let task: Record<string, unknown> | null = { id: 1002, [TaskCodes.parentproject]: '94', [TaskCodes.client]: '45', [TaskCodes.project]: '67' }
  let report: Record<string, unknown> | null = { id: 5402, [DailyReportCodes.parentproject]: '94' }
  const projects = { findOne: jest.fn().mockResolvedValue(project), save: jest.fn() }
  const bitrix = {
    getItem: jest.fn(({ entityTypeId }: { entityTypeId: number }) => Promise.resolve(
      entityTypeId === EntityTypeIds.projects ? liveProject : entityTypeId === EntityTypeIds.tasks ? task : report,
    )),
    getListElements: jest.fn().mockResolvedValue([{ id: 3, title: 'Разработка' }, { id: 5, title: 'Встреча' }]),
    addItem: jest.fn(), updateItem: jest.fn(),
  }
  return {
    service: new SupportReportEditorService(projects as never, bitrix as never), projects, bitrix,
    setTask: (value: Record<string, unknown> | null) => { task = value },
    setProject: (value: Record<string, unknown> | null) => { liveProject = value },
    setReport: (value: Record<string, unknown> | null) => { report = value },
  }
}

describe('SupportReportEditorService', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(now) })
  afterEach(() => { jest.useRealTimers() })

  it('prepares a task report with canonical project/company and task context without server-side writes', async () => {
    const f = fixture()
    const result = await f.service.prepare(31, validDto({ taskId: 1002, description: '  Исправлена загрузка документов  ' }))
    expect(result).toMatchObject({
      entityTypeId: EntityTypeIds.reports,
      fields: {
        [DailyReportCodes.title]: 'Исправлена загрузка документов',
        [DailyReportCodes.parentproject]: 94,
        [DailyReportCodes.parentId]: 1002,
        [DailyReportCodes.company]: 215,
        [DailyReportCodes.client]: 45,
        [DailyReportCodes.project]: 67,
        [DailyReportCodes.timeSpent]: 1.5,
        [DailyReportCodes.includeInPackage]: 1,
        [DailyReportCodes.activityType]: 3,
        begindate: '2026-09-29',
      },
    })
    expect(result.fields).not.toHaveProperty('assignedById')
    expect(f.projects.save).not.toHaveBeenCalled()
    expect(f.bitrix.addItem).not.toHaveBeenCalled()
    expect(f.bitrix.updateItem).not.toHaveBeenCalled()
  })

  it('allows a standalone project report and explicitly sends false package inclusion', async () => {
    const f = fixture()
    const result = await f.service.prepare(31, validDto({ includeInPackage: false, activityId: 5 }))
    expect(result.fields).toMatchObject({
      [DailyReportCodes.parentproject]: 94,
      [DailyReportCodes.parentId]: 0,
      [DailyReportCodes.company]: 215,
      [DailyReportCodes.includeInPackage]: 0,
    })
    expect(f.bitrix.getItem.mock.calls.some(([params]) => params.entityTypeId === EntityTypeIds.tasks)).toBe(false)
  })

  it('rejects linking a task from a different project', async () => {
    const f = fixture()
    f.setTask({ id: 1002, [TaskCodes.parentproject]: '95' })
    await expect(f.service.prepare(31, validDto({ taskId: 1002 }))).rejects.toThrow('Задача должна принадлежать выбранному проекту')
    expect(f.bitrix.addItem).not.toHaveBeenCalled()
  })

  it('rejects a deleted task and an unexpected task ID returned by Bitrix', async () => {
    const f = fixture()
    f.setTask(null)
    await expect(f.service.prepare(31, validDto({ taskId: 1002 }))).rejects.toBeInstanceOf(BadRequestException)
    f.setTask({ id: 1003, [TaskCodes.parentproject]: '94' })
    await expect(f.service.prepare(31, validDto({ taskId: 1002 }))).rejects.toBeInstanceOf(BadRequestException)
  })

  it('requires a current available activity without assigning an arbitrary default', async () => {
    const f = fixture()
    await expect(f.service.prepare(31, validDto({ activityId: 99 }))).rejects.toThrow('Выберите доступный вид работы')
    const dto = Object.assign(new PrepareSupportReportDto(), validDto())
    Reflect.deleteProperty(dto, 'activityId')
    expect((await validate(dto)).some((error) => error.property === 'activityId')).toBe(true)
    expect(f.bitrix.getListElements).toHaveBeenCalledWith(REPORT_ACTIVITY_IBLOCK_ID)
  })

  it('rejects empty descriptions and future dates before calling Bitrix', async () => {
    const f = fixture()
    await expect(f.service.prepare(31, validDto({ description: ' \n ' }))).rejects.toThrow('Опишите выполненную работу')
    await expect(f.service.prepare(31, validDto({ reportDate: '2026-09-30' }))).rejects.toThrow('Дата отчёта не может быть в будущем')
    expect(f.bitrix.getItem).not.toHaveBeenCalled()
  })

  it('uses the Moscow calendar day at UTC midnight boundaries', async () => {
    jest.setSystemTime(new Date('2026-09-29T21:30:00Z'))
    const f = fixture()
    await expect(f.service.prepare(31, validDto({ reportDate: '2026-09-30' }))).resolves.toHaveProperty('fields.begindate', '2026-09-30')
  })

  it('validates strict calendar dates, positive hours and real boolean flags at the HTTP DTO boundary', async () => {
    const dto = Object.assign(new PrepareSupportReportDto(), validDto(), { reportDate: '2026-02-30', hours: 0, includeInPackage: 'false' })
    const errors = await validate(dto)
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['reportDate', 'hours', 'includeInPackage']))
  })

  it('does not allow editing a report belonging to another project', async () => {
    const f = fixture()
    f.setReport({ id: 5402, [DailyReportCodes.parentproject]: '95' })
    await expect(f.service.edit(31, 5402)).rejects.toThrow('Отчёт относится к другому проекту')
    await expect(f.service.prepare(31, validDto({ reportId: 5402 }))).rejects.toThrow('Отчёт относится к другому проекту')
  })

  it.each(['Y', true, 1, '1'])('reads checked Bitrix flag %s as included and parses editable values', async (flag) => {
    const f = fixture()
    f.setReport({
      id: 5402, [DailyReportCodes.parentproject]: '94', [DailyReportCodes.parentId]: '1002',
      [DailyReportCodes.title]: 'Работа', [DailyReportCodes.timeSpent]: '1,5',
      [DailyReportCodes.activityType]: '3', [DailyReportCodes.includeInPackage]: flag,
      begindate: '2026-09-28T22:30:00Z',
    })
    expect(await f.service.edit(31, 5402)).toEqual({ id: 5402, taskId: 1002, description: 'Работа', hours: 1.5, activityId: 3, includeInPackage: true, reportDate: '2026-09-29' })
  })

  it.each(['N', false, 0, '0', null])('reads unchecked Bitrix flag %s as excluded', async (flag) => {
    const f = fixture()
    f.setReport({ id: 5402, [DailyReportCodes.parentproject]: '94', [DailyReportCodes.includeInPackage]: flag, createdTime: now.toISOString() })
    expect((await f.service.edit(31, 5402)).includeInPackage).toBe(false)
  })

  it('rejects unavailable or reclassified support projects instead of trusting stale local metadata', async () => {
    const f = fixture()
    f.projects.findOne.mockResolvedValueOnce(null)
    await expect(f.service.prepare(31, validDto())).rejects.toBeInstanceOf(NotFoundException)
    f.setProject({ id: 94, [ProjectCodes.financialProjectType]: '409' })
    await expect(f.service.prepare(31, validDto())).rejects.toThrow('Проект больше не относится к техподдержке')
    f.setProject(null)
    await expect(f.service.prepare(31, validDto())).rejects.toBeInstanceOf(BadGatewayException)
  })
})
