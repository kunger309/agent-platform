import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SCOPE_KEY = 'requireScope';

/**
 * 标记对外 REST API 端点所需的 API Key 能力范围。
 * 由 ApiKeyGuard 读取校验，与内部 @RequirePermission 体系互不干扰。
 */
export const RequireScope = (scope: string) =>
  SetMetadata(REQUIRE_SCOPE_KEY, scope);
