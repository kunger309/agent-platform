import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_PERMISSION_KEY,
} from '../decorators/require-permission.decorator';

/**
 * 权限守卫：检查 @RequirePermission() 或 @RequireAnyPermission() 装饰器标记的权限码
 *
 * 使用方法：在 Controller 上加 @UseGuards(PermissionsGuard)，在方法上加 @RequirePermission('user:create')
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | { type: string; codes: string[] }>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 没有 @RequirePermission 装饰器 → 不做检查
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    // super_admin 拥有所有权限
    if (user.isSuperAdmin) return true;

    const userCodes: string[] = user.permissionCodes ?? [];

    // 单权限码（字符串）
    if (typeof required === 'string') {
      if (!userCodes.includes(required)) {
        throw new ForbiddenException(`Missing permission: ${required}`);
      }
      return true;
    }

    // 多权限码（OR 语义）
    if (required && required.type === 'any' && Array.isArray(required.codes)) {
      const has = required.codes.some((c) => userCodes.includes(c));
      if (!has) {
        throw new ForbiddenException(
          `Missing any permission of: ${required.codes.join(', ')}`,
        );
      }
      return true;
    }

    return true;
  }
}