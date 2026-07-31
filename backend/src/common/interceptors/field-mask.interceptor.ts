import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, mergeMap, of } from 'rxjs';
import { RbacService } from '../../rbac/rbac.service';
import { MASK_RESOURCE_KEY } from '../decorators/mask-resource.decorator';

/**
 * 字段级权限拦截器：对标记了 @MaskResource(x) 的端点，
 * 按当前用户角色（含继承）的字段策略对响应体做隐藏 / 脱敏。
 *
 * - 超管不受限制
 * - 未配置任何字段策略时零开销直接透传
 * - 只处理 { success, data } 包装体与裸对象/数组两种常见形态
 */
@Injectable()
export class FieldMaskInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const resource = this.reflector.getAllAndOverride<string>(MASK_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!resource) return next.handle();

    const user = context.switchToHttp().getRequest()?.user;
    if (!user || user.isSuperAdmin) return next.handle();

    const roleIds: string[] = user.roleIds || [];
    if (!roleIds.length) return next.handle();

    return next.handle().pipe(
      mergeMap((body) =>
        from(this.rbac.resolveFieldPolicies(roleIds, resource)).pipe(
          mergeMap((policies) => {
            if (!policies.size) return of(body);
            if (body && typeof body === 'object' && 'data' in body) {
              return of({
                ...body,
                data: this.rbac.applyFieldPolicies((body as any).data, policies),
              });
            }
            return of(this.rbac.applyFieldPolicies(body, policies));
          }),
        ),
      ),
    );
  }
}
