import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger, NestApplicationOptions } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { MetricsInterceptor } from './metrics/metrics.interceptor';
import { FieldMaskInterceptor } from './common/interceptors/field-mask.interceptor';

const bootLogger = new Logger('Bootstrap');

// 上传目录（跟随启动 cwd，即 backend 根，编译/开发模式一致）
const uploadsDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadsDir)) {
  mkdirSync(uploadsDir, { recursive: true });
}


// 全局兜底：拦所有未捕获的异步异常，防止进程崩溃
// 必须放在 bootstrap() 之前才能拦到 bootstrap 自身抛出的异常
process.on('unhandledRejection', (reason: any) => {
  bootLogger.error(`Unhandled Promise Rejection: ${reason?.message || reason}`);
  if (reason?.stack) bootLogger.error(reason.stack);
});
process.on('uncaughtException', (err: any) => {
  bootLogger.error(`Uncaught Exception: ${err?.message || err}`);
  if (err?.stack) bootLogger.error(err.stack);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const reflector = app.get(Reflector);

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const apiPrefix = config.get<string>('API_PREFIX', '/api');
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:5173');

  // 全局路由前缀
  app.setGlobalPrefix(apiPrefix.replace(/^\//, ''));

  // 全局校验
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 全局异常过滤器
  app.useGlobalFilters(new HttpExceptionFilter());

  // 全局守卫（顺序：JwtAuthGuard 鉴权 → PermissionsGuard 权限码校验）
  app.useGlobalGuards(
    new JwtAuthGuard(reflector),
    new PermissionsGuard(reflector),
  );

  // 全局拦截器（顺序：指标统计 → 字段级脱敏，脱敏在最后一层改写响应体）
  app.useGlobalInterceptors(
    app.get(MetricsInterceptor),
    app.get(FieldMaskInterceptor),
  );

  // CORS
  app.enableCors({
    origin: corsOrigin.split(',').map((s) => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
  });

  // 静态托管上传文件（图片/文档），供前端 <img src="/uploads/xxx"> 访问
  app.useStaticAssets(uploadsDir, { prefix: '/uploads' });

  // 调大 JSON body 上限（默认 1 MB，多模态大图/长消息会被截断）
  // - 必须在 listen 之前注册，覆盖 Nest 默认 bodyParser
  // - multipart 路径走 FilesInterceptor（10 MB/10 个，不受此处影响）
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`🚀 Backend running on http://localhost:${port}${apiPrefix}`);
  logger.log(`📚 Environment: ${config.get<string>('NODE_ENV', 'development')}`);
  logger.log(`🔐 CORS origin: ${corsOrigin}`);
}

bootstrap();