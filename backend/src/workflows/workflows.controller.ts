import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  Res,
  HttpCode,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { WorkflowStatus } from '@prisma/client';
import { WorkflowsService } from './workflows.service';
import { CreateWorkflowDto, UpdateWorkflowDto, RunWorkflowDto } from './dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

const ALLOWED_STATUS_FILTERS: ReadonlySet<WorkflowStatus> = new Set([
  WorkflowStatus.draft,
  WorkflowStatus.published,
  WorkflowStatus.archived,
]);

@Controller('workflows')
export class WorkflowsController {
  private readonly logger = new Logger(WorkflowsController.name);
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  @RequirePermission('workflow:list')
  async list(@Request() req: any, @Query('status') status?: string) {
    let statusFilter: WorkflowStatus | undefined;
    if (status) {
      if (!ALLOWED_STATUS_FILTERS.has(status as WorkflowStatus)) {
        throw new BadRequestException(`非法 status 过滤值: ${status}`);
      }
      statusFilter = status as WorkflowStatus;
    }
    const data = await this.workflows.list(req.user.currentOrgId, statusFilter);
    return { success: true, data };
  }

  /**
   * 仅返回已发布工作流（用于智能体绑定下拉）。
   * 独立端点避免 status 参数被误用过滤到草稿。
   */
  @Get('published')
  @RequirePermission('workflow:list')
  async listPublished(@Request() req: any) {
    const data = await this.workflows.listPublished(req.user.currentOrgId);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('workflow:create')
  async create(@Body() dto: CreateWorkflowDto, @Request() req: any) {
    const data = await this.workflows.create(req.user.currentOrgId, req.user.userId, dto);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('workflow:list')
  async detail(@Param('id') id: string, @Request() req: any) {
    const data = await this.workflows.detail(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('workflow:edit')
  async update(@Param('id') id: string, @Body() dto: UpdateWorkflowDto, @Request() req: any) {
    const data = await this.workflows.update(id, req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Post(':id/publish')
  @RequirePermission('workflow:edit')
  async publish(@Param('id') id: string, @Request() req: any) {
    const data = await this.workflows.publish(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('workflow:edit')
  async remove(@Param('id') id: string, @Request() req: any) {
    const data = await this.workflows.remove(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Get(':id/executions')
  @RequirePermission('workflow:list')
  async listExecutions(@Param('id') id: string, @Request() req: any) {
    const data = await this.workflows.listExecutions(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Get(':id/executions/:eid')
  @RequirePermission('workflow:list')
  async getExecution(@Param('id') id: string, @Param('eid') eid: string, @Request() req: any) {
    const data = await this.workflows.getExecution(eid, req.user.currentOrgId);
    return { success: true, data };
  }

  /**
   * 运行工作流（SSE 流式）。
   * 事件流：run_start → node_start / node_token / node_end → done | error
   */
  @Post(':id/runs')
  @HttpCode(200)
  @RequirePermission('workflow:run')
  async run(
    @Param('id') id: string,
    @Body() dto: RunWorkflowDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let finished = false;
    let keepalive: NodeJS.Timeout | null = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ thinking: true })}\n\n`);
      } catch {
        /* 连接断开 */
      }
    }, 800);
    const stopKeepalive = () => {
      if (keepalive) {
        clearInterval(keepalive);
        keepalive = null;
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emit = (ev: any) => {
      stopKeepalive();
      try {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {
        /* 连接断开 */
      }
      if (ev.type === 'done' || ev.type === 'error') {
        finished = true;
        stopKeepalive();
        res.end();
      }
    };

    try {
      await this.workflows.run(id, req.user.currentOrgId, req.user.userId, dto, emit);
    } catch (e: any) {
      this.logger.error(`[WorkflowsController] run failed: ${e?.message}`);
      if (!finished) emit({ type: 'error', message: e?.message || String(e) });
    }
    if (!finished) {
      stopKeepalive();
      res.end();
    }
    // 客户端主动断连时清定时器
    req.on('close', () => stopKeepalive());
  }
}
