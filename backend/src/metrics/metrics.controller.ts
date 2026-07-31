import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Request,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import { SkipAuth } from '../common/decorators/public.decorator';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Prometheus 抓取端点：GET /api/metrics
   *
   * 抓取方通常没有 JWT，所以跳过登录鉴权；
   * 若配置了 METRICS_TOKEN，则要求 `?token=` 或 `Authorization: Bearer <token>` 匹配。
   * 未配置时仅建议在内网/网关层做访问控制。
   */
  @Get('metrics')
  @SkipAuth()
  async scrape(@Request() req: any, @Res() res: Response, @Query('token') token?: string) {
    const expected = this.config.get<string>('METRICS_TOKEN');
    if (expected) {
      const header = req.headers?.authorization;
      const bearer =
        typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice(7).trim()
          : null;
      if (token !== expected && bearer !== expected) {
        throw new ForbiddenException('metrics token 不正确');
      }
    }

    const body = await this.metrics.scrape();
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(body);
  }

  /**
   * 运维看板用的 JSON 摘要：GET /api/monitor/summary?hours=24
   * 走正常 JWT + 权限校验，仅返回当前组织数据。
   */
  @Get('monitor/summary')
  @RequirePermission('monitor:view')
  async summary(@Request() req: any, @Query('hours') hours?: string) {
    const h = Math.min(Math.max(parseInt(hours || '24', 10) || 24, 1), 168);
    const data = await this.metrics.summary(req.user.currentOrgId, h);
    return { success: true, data };
  }
}
