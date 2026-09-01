import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

/**
 * 标记 Controller 方法所需的权限码
 * @example
 *   @RequirePermission('user:create')
 *   @Post()
 *   create() {}
 */
export const RequirePermission = (code: string) => SetMetadata(REQUIRE_PERMISSION_KEY, code);

/**
 * 标记 Controller 方法所需的任一权限码（OR 语义）
 * @example
 *   @RequireAnyPermission(['user:list', 'user:edit'])
 */
export const RequireAnyPermission = (codes: string[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, { type: 'any', codes });