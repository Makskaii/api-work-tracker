import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { CreateProjectPaymentDto } from './dto/create-project-payment.dto'
import { UpdateProjectPaymentDto } from './dto/update-project-payment.dto'
import { ProjectGanttStage } from './entities/project-gantt-stage.entity'
import { ProjectPayment } from './entities/project-payment.entity'

@Injectable()
export class ProjectPaymentsService {
  constructor(
    @InjectRepository(ProjectPayment)
    private readonly paymentsRepository: Repository<ProjectPayment>,
    @InjectRepository(ProjectGanttStage)
    private readonly stagesRepository: Repository<ProjectGanttStage>,
  ) {}

  async findProjectPayments(projectId: string): Promise<ProjectPayment[]> {
    return this.paymentsRepository.find({
      where: { projectId },
      relations: { stage: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    })
  }

  async createProjectPayment(
    projectId: string,
    dto: CreateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    await this.assertStageBelongsToProject(dto.stageId, projectId)

    const payment = this.paymentsRepository.create({
      projectId,
      stageId: dto.stageId,
      status: dto.status,
      paymentDate: dto.paymentDate ?? null,
      percent: dto.percent ?? null,
      amount: dto.amount ?? null,
      waitingDays: dto.waitingDays ?? null,
      sortOrder: dto.sortOrder ?? 0,
    })

    return this.paymentsRepository.save(payment)
  }

  async updatePayment(
    paymentId: number,
    dto: UpdateProjectPaymentDto,
  ): Promise<ProjectPayment> {
    const payment = await this.findPaymentOrFail(paymentId)

    if (dto.stageId !== undefined) {
      await this.assertStageBelongsToProject(dto.stageId, payment.projectId)
      payment.stageId = dto.stageId
    }

    if (dto.status !== undefined) {
      payment.status = dto.status
    }

    if (dto.paymentDate !== undefined) {
      payment.paymentDate = dto.paymentDate
    }

    if (dto.percent !== undefined) {
      payment.percent = dto.percent
    }

    if (dto.amount !== undefined) {
      payment.amount = dto.amount
    }

    if (dto.waitingDays !== undefined) {
      payment.waitingDays = dto.waitingDays
    }

    if (dto.sortOrder !== undefined) {
      payment.sortOrder = dto.sortOrder ?? 0
    }

    return this.paymentsRepository.save(payment)
  }

  async deletePayment(paymentId: number): Promise<void> {
    await this.findPaymentOrFail(paymentId)
    await this.paymentsRepository.delete(paymentId)
  }

  private async findPaymentOrFail(paymentId: number) {
    const payment = await this.paymentsRepository.findOne({
      where: { id: paymentId },
    })

    if (!payment) {
      throw new NotFoundException('Оплата не найдена')
    }

    return payment
  }

  private async assertStageBelongsToProject(
    stageId: number,
    projectId: string,
  ) {
    const stage = await this.stagesRepository.findOne({
      where: { id: stageId },
    })

    if (!stage || stage.projectId !== projectId) {
      throw new BadRequestException('Этап не принадлежит проекту')
    }
  }
}
