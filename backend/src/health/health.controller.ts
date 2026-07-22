import { Controller, Get } from '@nestjs/common';
import { SkipAuth } from '../common/decorators/public.decorator';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @SkipAuth()
  @Get()
  async check() {
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();

    let dbStatus = 'unknown';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = 'up';
    } catch {
      dbStatus = 'down';
    }

    return {
      success: true,
      data: {
        status: dbStatus === 'up' ? 'ok' : 'degraded',
        uptime: `${Math.floor(uptime)}s`,
        timestamp,
        services: {
          database: dbStatus,
        },
      },
    };
  }
}