import { Controller, Post, Get, Patch, Body, Request, UseGuards } from '@nestjs/common';
import { SkipAuth } from '../common/decorators/public.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @SkipAuth()
  @Post('login')
  async login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  /** 获取当前登录用户信息（用于刷新页面后还原 user store） */
  @Get('me')
  async me(@Request() req: any) {
    return {
      success: true,
      data: {
        id: req.user.userId,
        username: req.user.username,
        name: (req.user as any).name,
        email: (req.user as any).email,
        avatar: (req.user as any).avatar,
        isSuperAdmin: req.user.isSuperAdmin,
        roles: req.user.roles,
        permissionCodes: req.user.permissionCodes,
        organizations: req.user.organizations,
        currentOrgId: req.user.currentOrgId,
      },
    };
  }

  @Post('logout')
  async logout() {
    return { success: true, message: 'Logged out' };
  }

  /** 当前用户修改自己的密码（个人中心） */
  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  async changePassword(
    @Request() req: any,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    await this.authService.changePassword(req.user.userId, body.oldPassword, body.newPassword);
    return { success: true, message: 'Password changed' };
  }
}