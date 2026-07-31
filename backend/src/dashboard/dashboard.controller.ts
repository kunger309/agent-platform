import { Controller, Get, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

/**
 * 工作台统计端点。JWT 鉴权（默认全局守卫），不强制业务权限码——
 * 工作台是登录后通用页面，所有登录用户都可看自己组织的统计。
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('stats')
  async stats(@Request() req: any) {
    const data = await this.dashboard.stats(req.user.currentOrgId);
    return { success: true, data };
  }
}