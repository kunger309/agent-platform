import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { ALLOWED_IPS } from './sql.constants';

/**
 * LocalOnlyGuard：只允许本机（127.0.0.1 / ::1）调用内部 SQL 端点。
 *
 * 设计目标：
 * - 工作流 HTTP 节点从后端进程内 fetch localhost，是这个端点的合法调用方
 * - 拒绝一切外部请求，避免被任意前端/中间人访问
 *
 * 注意：Express 默认会把 X-Forwarded-For 写进 req.ip；NestJS 默认 trust proxy = false，
 * 所以 req.socket.remoteAddress 即直连 TCP 来源 IP，不受代理头伪造影响。
 */
@Injectable()
export class LocalOnlyGuard implements CanActivate {
  private readonly logger = new Logger(LocalOnlyGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const remote = req.socket?.remoteAddress || req.ip || '';
    const normalized = remote.replace(/^::ffff:/i, '');
    const isLocal =
      ALLOWED_IPS.some((ip) => ip.replace(/^::ffff:/i, '') === normalized) ||
      normalized === '127.0.0.1' ||
      normalized === '::1';

    if (!isLocal) {
      this.logger.warn(
        `[Sql] 拒绝外部调用: remote=${remote} url=${req.originalUrl}`,
      );
      throw new ForbiddenException('该接口仅允许本机调用');
    }
    return true;
  }
}