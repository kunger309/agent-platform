import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { Readable } from 'stream';
import { SkipAuth } from '../common/decorators/public.decorator';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { RequireScope } from '../api-keys/decorators/require-scope.decorator';
import { AgentsService } from '../agents/agents.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { RetrieversService } from '../retrievers/retrievers.service';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../metrics/metrics.service';
import { PublicChatDto, PublicRunDto, PublicSearchDto } from './dto';

/**
 * 对外开放 REST API（/api/v1/**），以 API Key 鉴权。
 *
 * 与内部管理 API 的区别：
 * - 鉴权：API Key（scopes）而非 JWT（permissionCodes）
 * - 默认返回一次性 JSON，`stream: true` 时才走 SSE，便于第三方后端直连
 * - 组织边界由 Key 绑定的 organizationId 决定，调用方无法跨组织
 */
@SkipAuth()
@UseGuards(ApiKeyGuard)
@Controller('v1')
export class PublicApiController {
  private readonly logger = new Logger(PublicApiController.name);

  constructor(
    private readonly agents: AgentsService,
    private readonly workflows: WorkflowsService,
    private readonly retrievers: RetrieversService,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  // ==================== 元信息 ====================

  /** 自检端点：确认 Key 有效并回显其能力范围 */
  @Get('me')
  me(@Request() req: any) {
    const k = req.apiKey;
    return {
      success: true,
      data: {
        keyId: k.id,
        name: k.name,
        organizationId: k.organizationId,
        scopes: k.scopes,
      },
    };
  }

  // ==================== 智能体 ====================

  @Get('agents')
  @RequireScope('agent:read')
  async listAgents(@Request() req: any) {
    const rows = await this.prisma.agent.findMany({
      where: { organizationId: req.apiKey.organizationId, status: 'published' },
      select: { id: true, name: true, description: true, type: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return { success: true, data: rows };
  }

  /**
   * 调用智能体对话。
   * - stream=false（默认）：等待生成完毕，返回 { conversationId, content }
   * - stream=true：SSE，事件与内部端点一致（delta / done / error）
   */
  @Post('agents/:id/chat')
  @RequireScope('agent:chat')
  @HttpCode(200)
  async chat(
    @Param('id') id: string,
    @Body() dto: PublicChatDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const started = Date.now();
    const { stream, conversationId } = await this.agents.chat(id, req.user, {
      message: dto.message,
      conversationId: dto.conversationId,
    } as any);

    if (dto.stream) {
      this.writeSseHeaders(res);
      res.write(`data: ${JSON.stringify({ conversationId })}\n\n`);
      stream.on('data', (c: Buffer) => res.write(c));
      stream.on('end', () => {
        this.metrics.observeApiKeyCall(req.apiKey.id, 'agent:chat', 'success', Date.now() - started);
        res.end();
      });
      stream.on('error', (e: any) => {
        this.metrics.observeApiKeyCall(req.apiKey.id, 'agent:chat', 'error', Date.now() - started);
        res.write(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
        res.end();
      });
      return;
    }

    try {
      const content = await this.collectSseText(stream);
      this.metrics.observeApiKeyCall(req.apiKey.id, 'agent:chat', 'success', Date.now() - started);
      res.json({ success: true, data: { conversationId, content } });
    } catch (e: any) {
      this.metrics.observeApiKeyCall(req.apiKey.id, 'agent:chat', 'error', Date.now() - started);
      res.status(500).json({ success: false, message: e?.message || String(e) });
    }
  }

  // ==================== 工作流 ====================

  @Get('workflows')
  @RequireScope('workflow:read')
  async listWorkflows(@Request() req: any) {
    const rows = await this.prisma.workflow.findMany({
      where: { organizationId: req.apiKey.organizationId },
      select: { id: true, name: true, description: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });
    return { success: true, data: rows };
  }

  /**
   * 运行工作流。
   * - stream=false（默认）：执行完毕返回 { runId, output, variables }
   * - stream=true：SSE，事件与内部端点一致
   */
  @Post('workflows/:id/run')
  @RequireScope('workflow:run')
  @HttpCode(200)
  async run(
    @Param('id') id: string,
    @Body() dto: PublicRunDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const started = Date.now();
    const orgId = req.apiKey.organizationId;
    const userId = req.apiKey.creatorId;

    if (dto.stream) {
      this.writeSseHeaders(res);
      let finished = false;
      const emit = (ev: any) => {
        try {
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        } catch {
          /* 连接已断开 */
        }
        if (ev.type === 'done' || ev.type === 'error') {
          finished = true;
          res.end();
        }
      };
      try {
        await this.workflows.run(id, orgId, userId, { input: dto.input } as any, emit);
        this.metrics.observeApiKeyCall(req.apiKey.id, 'workflow:run', 'success', Date.now() - started);
      } catch (e: any) {
        this.metrics.observeApiKeyCall(req.apiKey.id, 'workflow:run', 'error', Date.now() - started);
        if (!finished) emit({ type: 'error', message: e?.message || String(e) });
      }
      if (!finished) res.end();
      return;
    }

    // 非流式：把事件收进内存，只回最终结果 + 节点摘要
    let runId: string | undefined;
    let output = '';
    let variables: Record<string, any> = {};
    let errorMessage: string | undefined;
    const nodes: Array<{ nodeId: string; nodeType: string; durationMs: number }> = [];

    const emit = (ev: any) => {
      if (ev.type === 'run_start') runId = ev.runId;
      else if (ev.type === 'node_end')
        nodes.push({ nodeId: ev.nodeId, nodeType: ev.nodeType, durationMs: ev.durationMs });
      else if (ev.type === 'done') {
        output = ev.output || '';
        variables = ev.variables || {};
      } else if (ev.type === 'error') errorMessage = ev.message;
    };

    try {
      await this.workflows.run(id, orgId, userId, { input: dto.input } as any, emit);
    } catch (e: any) {
      errorMessage = e?.message || String(e);
    }

    const ms = Date.now() - started;
    if (errorMessage) {
      this.metrics.observeApiKeyCall(req.apiKey.id, 'workflow:run', 'error', ms);
      res.status(500).json({ success: false, message: errorMessage, data: { runId, nodes } });
      return;
    }
    this.metrics.observeApiKeyCall(req.apiKey.id, 'workflow:run', 'success', ms);
    res.json({ success: true, data: { runId, output, variables, nodes, durationMs: ms } });
  }

  // ==================== 知识库检索 ====================

  @Post('knowledge-bases/:id/search')
  @RequireScope('kb:search')
  @HttpCode(200)
  async search(
    @Param('id') id: string,
    @Body() dto: PublicSearchDto,
    @Request() req: any,
  ) {
    const started = Date.now();
    try {
      const data = await this.retrievers.retrieve(
        req.apiKey.organizationId,
        id,
        dto.query,
        { topK: dto.topK ?? 5 },
      );
      this.metrics.observeApiKeyCall(req.apiKey.id, 'kb:search', 'success', Date.now() - started);
      return { success: true, data };
    } catch (e: any) {
      this.metrics.observeApiKeyCall(req.apiKey.id, 'kb:search', 'error', Date.now() - started);
      throw e;
    }
  }

  // ==================== 内部工具 ====================

  private writeSseHeaders(res: Response) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
  }

  /**
   * 把 AgentsService.chat 产出的 SSE 流聚合成完整文本。
   * 流里的分片本身就是 `data: {...}\n\n` 格式，这里做一次反序列化。
   */
  private collectSseText(stream: Readable): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let text = '';
      let failed: string | null = null;

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!raw.startsWith('data:')) continue;
          const payload = raw.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const ev = JSON.parse(payload);
            if (typeof ev.delta === 'string') text += ev.delta;
            if (ev.error) failed = ev.error;
          } catch {
            /* 心跳等非 JSON 分片，忽略 */
          }
        }
      });
      stream.on('end', () => (failed ? reject(new Error(failed)) : resolve(text)));
      stream.on('error', (e: any) => reject(e));
    });
  }
}
