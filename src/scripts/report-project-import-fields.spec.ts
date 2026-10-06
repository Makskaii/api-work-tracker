import { ConflictException } from '@nestjs/common'
import { ReportProjectType } from '../project-reports/entities/project-report-project.entity'
import { getReportProjectImportFields } from './report-project-import-fields'

const link = { bitrixProjectId: '77', clientCompanyId: '22', clientCompany: 'Company', title: 'CRM title' }

describe('report project import metadata ownership', () => {
  it('updates only the company relation and retains local dates, hours, title and team', () => {
    const existing = {
      bitrixProjectId: '77', title: 'WT title', contractEndDate: '2026-12-31', projectStartDate: '2026-10-01',
      summaryPlanCompletionDate: '2026-12-01', summaryFactCompletionDate: '2027-01-05',
      summaryPurchasedHours: 0, summaryPlanHours: 80, summaryFactHours: 12.5,
      developmentPlanEndDate: '2026-11-20', developmentWeeks: 8, responsibleId: '3', projectType: ReportProjectType.Support,
    }
    const remoteSource = { ...link, contractEndDate: '2030-01-01', summaryPurchasedHours: 999 }
    const fields = getReportProjectImportFields(remoteSource, existing)
    expect(fields).toEqual({ bitrixProjectId: '77', clientCompanyId: '22', clientCompany: 'Company' })
    expect({ ...existing, ...fields }).toEqual({ ...existing, clientCompanyId: '22', clientCompany: 'Company' })
  })

  it('creates only identity and company metadata without importing CRM dates or hours', () => {
    expect(getReportProjectImportFields(link)).toEqual({
      bitrixProjectId: '77', clientCompanyId: '22', clientCompany: 'Company', title: 'CRM title', projectType: ReportProjectType.Waterfall,
    })
  })

  it('adds a missing relation without replacing locally entered project metadata', () => {
    expect(getReportProjectImportFields(link, { bitrixProjectId: null })).not.toHaveProperty('title')
    expect(getReportProjectImportFields(link, { bitrixProjectId: null }).bitrixProjectId).toBe('77')
  })

  it('refuses to replace a different existing Bitrix relation based on a matching title', () => {
    expect(() => getReportProjectImportFields(link, { bitrixProjectId: '88' })).toThrow(ConflictException)
  })
})
