import { Body, Controller, Get, Header, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common'
import type { CookieOptions, Request, Response } from 'express'
import { IsString, Length, Matches } from 'class-validator'
import { CompleteEmployeeLoginDto } from './dto/complete-employee-login.dto'
import {
  EMPLOYEE_COOKIE_PATH, EMPLOYEE_SESSION_COOKIE, EMPLOYEE_STATE_COOKIE, EmployeeAuthService,
} from './employee-auth.service'
import type { ResolvedEmployeeSession } from './employee-auth.types'

class EmployeeFrameLoginDto {
  @IsString()
  @Length(1, 4096)
  @Matches(/^[\x21-\x7e]+$/)
  accessToken!: string
}

const cookieOptions: CookieOptions = {
  httpOnly: true, secure: true, sameSite: 'lax', path: EMPLOYEE_COOKIE_PATH,
}

@Controller('auth/employee')
export class EmployeeAuthController {
  constructor(private readonly auth: EmployeeAuthService) {}

  @Get('login')
  @Header('Cache-Control', 'no-store')
  async login(@Query('returnTo') returnTo: string | undefined, @Res() response: Response) {
    const result = await this.auth.beginLogin(returnTo)
    response.cookie(EMPLOYEE_STATE_COOKIE, result.state, { ...cookieOptions, maxAge: 5 * 60 * 1000 })
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.redirect(302, result.url)
  }

  @Post('complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async complete(
    @Body() dto: CompleteEmployeeLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.auth.completeLogin(dto, request.headers.cookie, request.headers.origin)
      this.setSessionCookie(response, result.session)
      return { ...this.auth.response(result.session), returnTo: result.returnTo }
    } finally {
      response.clearCookie(EMPLOYEE_STATE_COOKIE, cookieOptions)
    }
  }

  @Post('frame')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async frame(@Body() dto: EmployeeFrameLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.createFrameSession(dto.accessToken, request.headers.cookie, request.headers.origin)
    this.setSessionCookie(response, session)
    return this.auth.response(session)
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() request: Request) {
    return this.auth.response(await this.auth.resolveSession(request.headers.cookie))
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: Request,
    @Headers('x-work-tracker-csrf') csrf: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logoutFromCookie(request.headers.cookie, request.headers.origin, csrf)
    response.clearCookie(EMPLOYEE_SESSION_COOKIE, cookieOptions)
    response.clearCookie(EMPLOYEE_STATE_COOKIE, cookieOptions)
  }

  private setSessionCookie(response: Response, session: ResolvedEmployeeSession): void {
    response.cookie(EMPLOYEE_SESSION_COOKIE, session.sessionId, { ...cookieOptions, expires: new Date(session.expiresAt) })
  }
}
