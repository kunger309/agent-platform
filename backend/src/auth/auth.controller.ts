import { Controller, Post, Body } from '@nestjs/common';
import { SkipAuth } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @SkipAuth()
  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Post('logout')
  async logout() {
    return { success: true, message: 'Logged out' };
  }
}