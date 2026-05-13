import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import { compare } from 'bcryptjs'
import { Repository } from 'typeorm'
import { LoginClientDto } from '../clients/dto/login-client.dto'
import { Client, ClientStatus } from '../clients/entities/client.entity'

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginClientDto: LoginClientDto) {
    const client = await this.clientsRepository.findOne({
      where: { email: loginClientDto.email },
    })

    if (!client) {
      throw new UnauthorizedException('Invalid email or password')
    }

    const isPasswordValid = await compare(
      loginClientDto.password,
      client.passwordHash,
    )

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password')
    }

    if (client.status !== ClientStatus.Active) {
      throw new ForbiddenException('Client is inactive')
    }

    const lastLogin = new Date()

    await this.clientsRepository.update(client.id, { lastLogin })

    const payload = {
      sub: client.id,
      email: client.email,
      crmClientId: client.crmClientId,
      role: 'client',
    }

    const accessToken = await this.jwtService.signAsync(payload)

    return {
      accessToken,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        crmClientId: client.crmClientId,
        status: client.status,
        lastLogin,
      },
    }
  }
}
