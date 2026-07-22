import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记路由无需 JWT 鉴权（用于 /health、/auth/login 等公开端点）
 * @example
 *   @SkipAuth()
 *   @Post('login')
 *   login() {}
 */
export const SkipAuth = () => SetMetadata(IS_PUBLIC_KEY, true);