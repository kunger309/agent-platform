import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipAuth } from '../../common/decorators/public.decorator';
import { LocalOnlyGuard } from './sql.guard';
import { SqlService } from './sql.service';
import { SqlQueryDto } from './sql.dto';

/**
 * 内部只读 SQL 查询端点。
 *
 * - POST /api/internal/sql/query
 * - body: { sql: "SELECT ..." }
 * - 返回: { success: true, data: { ok, rows, fields, rowCount, truncated, durationMs } }
 *
 * 安全层级（必须全部通过才能执行）：
 *   1) SkipAuth — 跳过 JWT 鉴权（工作流 HTTP 节点是后端进程内调用，无 Cookie）
 *   2) LocalOnlyGuard — 只允许 127.0.0.1 / ::1 调用
 *   3) SqlService 白名单校验 — 关键字黑名单 + 表白名单 + 单语句 + SELECT/WITH 开头
 *
 * 这是"工作流 → 后端 API"封闭链路内的最小可信网关。
 */
@Controller('internal/sql')
@UseGuards(LocalOnlyGuard)
export class SqlController {
  private readonly logger = new Logger(SqlController.name);

  constructor(private readonly sql: SqlService) {}

  @SkipAuth()
  @Post('query')
  @HttpCode(200)
  async query(@Body() dto: SqlQueryDto) {
    const t0 = Date.now();
    const result = await this.sql.query(dto.sql);
    this.logger.log(
      `[Sql] OK rows=${result.rowCount}${result.truncated ? '(truncated)' : ''} ` +
        `dur=${result.durationMs}ms total=${Date.now() - t0}ms`,
    );
    return { success: true, data: result };
  }
}