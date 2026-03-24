import { Body, Controller, Post } from '@nestjs/common'
import { LoginClientDto } from '../clients/dto/login-client.dto'
import { AuthService } from './auth.service'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('client')
  login(@Body() loginClientDto: LoginClientDto) {
    return this.authService.login(loginClientDto)
  }
}
