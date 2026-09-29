import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { DataSource } from 'typeorm'
import { PreviewSupportHoursPackageDto } from './dto/preview-support-hours-package.dto'
import type { UpdateSupportHoursPackageDto } from './dto/update-support-hours-package.dto'
import { SupportHoursPackage } from './entities/support-hours-package.entity'
import { SupportHoursReport } from './entities/support-hours-report.entity'
import { SupportHoursAssignment } from './entities/support-hours-assignment.entity'
import { SupportTaskAssignment } from './entities/support-task-assignment.entity'
import { allocateProjectSupportHours, type ProjectReportAssignment, type ProjectTaskAssignment } from './support-hours-allocation'
import type { SupportPackageImpact, SupportPackageImpactBalance } from './support-hours-package-impact.types'

type AllocationRow = { packageId: number; reportId: number; hours: number }
type PackageState = {
  id: number
  projectId: number
  purchasedHours: number
  purchaseDate: string
  amount: number | null
  comment: string | null
  updatedAt: string | null
}
type ReportState = { id: number; bitrixReportId: string; bitrixTaskId: string | null; hours: number; reportDate: string }

const round = (value: number): number => Math.round(value * 100) / 100
const asNumber = (value: unknown): number => {
  const result = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(result) ? result : 0
}
const dateText = (value: Date | string | undefined): string | null => value ? new Date(value).toISOString() : null
const packageOrder = (first: PackageState, second: PackageState): number => first.purchaseDate.localeCompare(second.purchaseDate) || first.id - second.id

function normalizeChanges(changes: UpdateSupportHoursPackageDto = {}): UpdateSupportHoursPackageDto {
  const normalized: UpdateSupportHoursPackageDto = {}
  if (changes.purchasedHours !== undefined) normalized.purchasedHours = round(changes.purchasedHours)
  if (changes.purchaseDate !== undefined) normalized.purchaseDate = changes.purchaseDate
  if (changes.amount !== undefined) normalized.amount = changes.amount == null ? null : round(changes.amount)
  if (changes.comment !== undefined) normalized.comment = changes.comment?.trim() || null
  return normalized
}

function balance(item: PackageState, rows: AllocationRow[]): SupportPackageImpactBalance {
  const ownRows = rows.filter((row) => row.packageId === item.id)
  const consumedHours = round(ownRows.reduce((total, row) => total + row.hours, 0))
  return {
    purchasedHours: item.purchasedHours,
    consumedHours,
    remainingHours: round(item.purchasedHours - consumedHours),
    reportCount: new Set(ownRows.filter((row) => row.hours > 0).map((row) => row.reportId)).size,
  }
}

function reportAllocations(report: ReportState, rows: AllocationRow[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const row of rows.filter((row) => row.reportId === report.id)) {
    result.set(row.packageId, round((result.get(row.packageId) ?? 0) + row.hours))
  }
  // Package ID 0 represents work not yet allocated to any package.
  result.set(0, round(Math.max(0, report.hours - [...result.values()].reduce((sum, hours) => sum + hours, 0))))
  return result
}

@Injectable()
export class SupportHoursPackageImpactService {
  constructor(private readonly dataSource: DataSource) {}

  async preview(packageId: number, request: PreviewSupportHoursPackageDto): Promise<SupportPackageImpact> {
    if (!Number.isSafeInteger(packageId) || packageId < 1) throw new BadRequestException('Некорректный номер пакета')
    if (request.operation !== 'update' && request.operation !== 'delete') throw new BadRequestException('Неизвестное действие с пакетом')
    if (request.operation === 'delete' && request.changes !== undefined) throw new BadRequestException('Для удаления изменения полей не нужны')
    if (request.operation === 'update' && !request.changes) throw new BadRequestException('Не указаны изменения пакета')
    const changes = normalizeChanges(request.changes)
    const snapshot = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SupportHoursPackage)
      const target = await repository.findOne({ where: { id: packageId } })
      if (!target) throw new NotFoundException('Support hours package not found')
      const packages = await repository.find({
        where: { projectId: target.projectId }, relations: { consumptions: true },
        order: { purchaseDate: 'ASC', id: 'ASC' },
      })
      const reports = await manager.getRepository(SupportHoursReport).find({
        where: { projectId: target.projectId }, order: { reportDate: 'ASC', id: 'ASC' },
      })
      const assignments = await manager.getRepository(SupportHoursAssignment).find({ where: { projectId: target.projectId } })
      const taskAssignments = await manager.getRepository(SupportTaskAssignment).find({ where: { projectId: target.projectId } })
      return { packages, reports, assignments, taskAssignments }
    })
    const packages: PackageState[] = snapshot.packages.map((item) => ({
      id: Number(item.id), projectId: Number(item.projectId), purchasedHours: asNumber(item.purchasedHours),
      purchaseDate: item.purchaseDate, amount: item.amount == null ? null : asNumber(item.amount),
      comment: item.comment ?? null, updatedAt: dateText(item.updatedAt),
    })).sort(packageOrder)
    const target = packages.find((item) => item.id === packageId)
    if (!target) throw new NotFoundException('Support hours package not found')
    const reports: ReportState[] = snapshot.reports.map((report) => ({
      id: Number(report.id), bitrixReportId: String(report.bitrixReportId), bitrixTaskId: report.bitrixTaskId == null ? null : String(report.bitrixTaskId),
      hours: asNumber(report.hours), reportDate: dateText(report.reportDate)!,
    })).sort((first, second) => first.reportDate.localeCompare(second.reportDate) || first.id - second.id)
    const assignments: (ProjectReportAssignment & { updatedAt: string | null })[] = snapshot.assignments.map((assignment) => ({
      bitrixReportId: String(assignment.bitrixReportId),
      allocations: assignment.allocations.map((allocation) => ({ packageId: Number(allocation.packageId), hours: asNumber(allocation.hours) })),
      updatedAt: dateText(assignment.updatedAt),
    })).sort((first, second) => first.bitrixReportId.localeCompare(second.bitrixReportId))
    const taskAssignments: (ProjectTaskAssignment & { updatedAt: string | null })[] = snapshot.taskAssignments.map((assignment) => ({
      bitrixTaskId: String(assignment.bitrixTaskId), packageId: assignment.packageId == null ? null : Number(assignment.packageId), updatedAt: dateText(assignment.updatedAt),
    })).sort((first, second) => first.bitrixTaskId.localeCompare(second.bitrixTaskId))
    const beforeRows: AllocationRow[] = snapshot.packages.flatMap((item) => item.consumptions.map((row) => ({
      packageId: Number(item.id), reportId: Number(row.reportId), hours: asNumber(row.hours),
    }))).sort((first, second) => first.reportId - second.reportId || first.packageId - second.packageId)
    const afterPackages = packages.filter((item) => request.operation !== 'delete' || item.id !== packageId)
      .map((item) => item.id === packageId ? { ...item, ...changes } : { ...item }).sort(packageOrder)
    const afterRows = allocateProjectSupportHours(afterPackages, reports, assignments, taskAssignments)
    const changedPackageIds = new Set<number>()
    let movedHours = 0
    let movedReportCount = 0
    let unallocatedHoursBefore = 0
    let unallocatedHoursAfter = 0
    for (const report of reports) {
      const before = reportAllocations(report, beforeRows)
      const after = reportAllocations(report, afterRows)
      unallocatedHoursBefore += before.get(0) ?? 0
      unallocatedHoursAfter += after.get(0) ?? 0
      let reportMovedHours = 0
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const difference = round((before.get(id) ?? 0) - (after.get(id) ?? 0))
        if (difference !== 0 && id !== 0) changedPackageIds.add(id)
        if (difference > 0) reportMovedHours += difference
      }
      if (reportMovedHours > 0) movedReportCount += 1
      movedHours += reportMovedHours
    }
    const hasRecordedHours = beforeRows.some((row) => row.packageId === packageId && row.hours > 0)
    const changesAllocation = request.operation === 'delete' ||
      (changes.purchasedHours !== undefined && changes.purchasedHours !== target.purchasedHours) ||
      (changes.purchaseDate !== undefined && changes.purchaseDate !== target.purchaseDate)
    const fingerprint = createHash('sha256').update(JSON.stringify({
      packageId, operation: request.operation, changes, packages, reports, beforeRows, assignments, taskAssignments,
    })).digest('hex')
    const hasManualReference = assignments.some((assignment) => assignment.allocations.some((allocation) => allocation.packageId === packageId)) ||
      taskAssignments.some((assignment) => assignment.packageId === packageId)
    return {
      packageId, projectId: target.projectId, operation: request.operation, fingerprint,
      requiresConfirmation: changesAllocation && (hasRecordedHours || movedHours > 0 || hasManualReference),
      packages: packages.map((item) => {
        const afterItem = afterPackages.find((candidate) => candidate.id === item.id)
        const before = balance(item, beforeRows)
        const after = afterItem ? balance(afterItem, afterRows) : null
        return {
          id: item.id, purchaseDate: afterItem?.purchaseDate ?? item.purchaseDate, before, after,
          affected: !afterItem || changedPackageIds.has(item.id) || item.purchaseDate !== afterItem.purchaseDate ||
            before.purchasedHours !== after?.purchasedHours,
        }
      }),
      movedHours: round(movedHours), movedReportCount,
      unallocatedHoursBefore: round(unallocatedHoursBefore), unallocatedHoursAfter: round(unallocatedHoursAfter),
    }
  }

  // Call inside the package service's mutation queue immediately before changing a package.
  async assertPreview(packageId: number, request: PreviewSupportHoursPackageDto, fingerprint?: string): Promise<void> {
    const current = await this.preview(packageId, request)
    if ((!fingerprint && current.requiresConfirmation) || (fingerprint && fingerprint.replace(/^"|"$/g, '') !== current.fingerprint)) {
      throw new ConflictException('Данные пакета изменились или последствия ещё не подтверждены. Обновите предварительный расчёт и подтвердите изменения.')
    }
  }
}
