import { Module } from '@nestjs/common';
import { SqlController } from './sql/sql.controller';
import { SqlService } from './sql/sql.service';
import { LocalOnlyGuard } from './sql/sql.guard';

/**
 * 内部工具模块（仅供后端进程内调用）。
 * 当前承载：
 *  - /api/internal/sql/query  —— 工作流 HTTP 节点使用的只读 SQL 网关
 */
@Module({
  controllers: [SqlController],
  providers: [SqlService, LocalOnlyGuard],
})
export class InternalModule {}