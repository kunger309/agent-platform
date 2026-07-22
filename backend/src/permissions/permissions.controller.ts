import { Controller, Get, Request } from '@nestjs/common';
import { SkipAuth } from '../common/decorators/public.decorator';
import { PermissionsService } from './permissions.service';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  /**
   * 当前登录用户的权限码列表 + 权限树（用于前端动态渲染菜单）
   * 全局 JwtAuthGuard 已自动拦截未登录请求
   */
  @Get('mine')
  async mine(@Request() req: any) {
    return {
      success: true,
      data: {
        codes: req.user.permissionCodes,
        isSuperAdmin: req.user.isSuperAdmin,
      },
    };
  }

  /**
   * 全量权限码树（用于角色管理页面）
   */
  @SkipAuth()
  @Get('tree')
  async tree() {
    const tree = await this.permissionsService.findTree();
    return { success: true, data: tree };
  }
}