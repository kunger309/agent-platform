import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * 全局 HTTP 指标拦截器。
 *
 * route 用 Nest 的路由模板（如 /api/agents/:id/chat）而非真实 URL，
 * 避免 id 进入 label 造成基数爆炸。
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    // /metrics 自身不统计，避免抓取动作污染 QPS
    const rawPath: string = req.route?.path || req.url || 'unknown';
    if (rawPath.includes('/metrics')) return next.handle();

    const method: string = req.method || 'GET';
    const route = this.normalizeRoute(req);
    const started = Date.now();

    this.metrics.incHttpInFlight(1);
    const done = (status: number) => {
      this.metrics.incHttpInFlight(-1);
      this.metrics.observeHttp(method, route, status, Date.now() - started);
    };

    return next.handle().pipe(
      tap({
        next: () => done(res.statusCode || 200),
        error: (err) => done(err?.status || err?.statusCode || 500),
      }),
    );
  }

  private normalizeRoute(req: any): string {
    const base: string = req.route?.path || '';
    if (base) {
      // Express 的 route.path 不含全局前缀，补回来便于识别
      const prefix = req.baseUrl || '';
      return `${prefix}${base}` || base;
    }
    // 未命中路由（404）统一归一，防止扫描器打爆基数
    return 'unmatched';
  }
}
