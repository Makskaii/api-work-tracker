import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Request } from 'express'

export type ClientJwtPayload = {
  sub: number
  email: string
  crmClientId: number
  role: 'client'
}

export type AuthenticatedClientRequest = Request & {
  client: ClientJwtPayload
}

@Injectable()
export class ClientJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedClientRequest>()

    const token = this.extractBearerToken(request)

    if (!token) {
      throw new UnauthorizedException('Missing access token')
    }

    try {
      const payload = await this.jwtService.verifyAsync<ClientJwtPayload>(token)

      if (payload.role !== 'client' || !payload.sub || !payload.crmClientId) {
        throw new UnauthorizedException('Invalid access token')
      }

      request.client = payload

      return true
    } catch {
      throw new UnauthorizedException('Invalid access token')
    }
  }

  private extractBearerToken(request: Request): string | null {
    const authorization = request.headers.authorization

    if (!authorization) {
      return null
    }

    const [type, token] = authorization.split(' ')

    return type === 'Bearer' && token ? token : null
  }
}
