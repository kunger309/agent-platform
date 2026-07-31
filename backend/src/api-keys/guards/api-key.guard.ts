import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../api-keys.service';
import { REQUIRE_SCOPE_KEY } from '../decorators/require-scope.decorator';

/**
 * 对外 REST API 鉴权守卫。
 *
 * 接受两种传参：
 *   Authorization: Bearer ak_xxx
 *   X-API-Key: ak_xxx
 *
 * 校验通过后在请求上挂：
 *   req.apiKey — API Key 上下文
 *   req.user   — 伪装的用户上下文，让下游 Service 无需为对外调用做特殊分支
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const plain = this.extractKey(req);
    if (!plain) {
      throw new UnauthorizedException(
        '缺少 API Key，请在 Authorization: Bearer <key> 或 X-API-Key 头中提供',
      );
    }

    const ctx = await this.apiKeys.verify(plain);
    if (!ctx) {
      throw new UnauthorizedException('API Key 无效、已吊销或已过期');
    }

    const required = this.reflector.getAllAndOverride<string>(
      REQUIRE_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && !ctx.scopes.includes(required)) {
      throw new ForbiddenException(
        `当前 API Key 缺少 ${required} 权限范围（已有：${ctx.scopes.join(', ') || '无'}）`,
      );
    }

    req.apiKey = ctx;
    req.user = {
      userId: ctx.creatorId,
      username: `apikey:${ctx.name}`,
      currentOrgId: ctx.organizationId,
      organizations: [{ id: ctx.organizationId }],
      isSuperAdmin: false,
      roles: [],
      // 对外调用的权限边界由 scopes 决定，此处不注入内部权限码
      permissionCodes: [],
      viaApiKey: true,
    };

    return true;
  }

  private extractKey(req: any): string | null {
    const header = req.headers?.['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      const v = header.slice(7).trim();
      if (v.startsWith('ak_')) return v;
    }
    const x = req.headers?.['x-api-key'];
    if (typeof x === 'string' && x.trim()) return x.trim();
    return null;
  }
}
