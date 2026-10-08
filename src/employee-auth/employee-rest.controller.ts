import { Body, Controller, Header, Post, Req, UnauthorizedException } from '@nestjs/common'
import { IsObject, IsString, Matches, MaxLength } from 'class-validator'
import type { EmployeeRequest } from './employee-access.guard'
import { EmployeeRestService } from './employee-rest.service'

export class EmployeeRestDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9_.]+$/)
  @MaxLength(80)
  method: string

  @IsObject()
  params: Record<string, unknown>
}

@Controller('auth/employee')
export class EmployeeRestController {
  constructor(private readonly rest: EmployeeRestService) {}

  @Post('rest')
  @Header('Cache-Control', 'no-store')
  call(@Req() request: EmployeeRequest, @Body() dto: EmployeeRestDto) {
    if (!request.employeeSession) throw new UnauthorizedException('Войдите в Work Tracker через Битрикс24')
    return this.rest.call(request.employeeSession, dto.method, dto.params)
  }
}
