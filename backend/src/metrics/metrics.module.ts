import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';

/**
 * 全局模块：任何业务 Service 都可直接注入 MetricsService 上报指标，
 * 无需在各自模块 imports 里重复声明。
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class MetricsModule {}
