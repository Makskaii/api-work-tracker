import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common'
import { AppService } from './app.service'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  async health() {
    const result = await this.appService.checkHealth()

    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result)
    }

    return result
  }
}
