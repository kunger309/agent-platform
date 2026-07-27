import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  Res,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { AgentsService } from './agents.service';
import {
  CreateAgentDto,
  UpdateAgentDto,
  ChatDto,
} from './dto/create-agent.dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @RequirePermission('agent:list')
  async list(@Request() req: any) {
    const data = await this.agents.list(req.user.currentOrgId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('agent:read')
  async detail(@Param('id') id: string, @Request() req: any) {
    const data = await this.agents.detail(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('agent:create')
  async create(@Body() dto: CreateAgentDto, @Request() req: any) {
    const data = await this.agents.create(
      req.user.currentOrgId,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('agent:update')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
    @Request() req: any,
  ) {
    const data = await this.agents.update(id, req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('agent:delete')
  async delete(@Param('id') id: string, @Request() req: any) {
    return this.agents.delete(id, req.user.currentOrgId);
  }

  /**
   * SSE 流式对话
   * - Content-Type: text/event-stream
   * - 数据格式：data: { delta: 'xxx' }\n\n / data: { done: true }\n\n
   * - 首个 data 含 conversationId 便于前端维持会话
   */
  @Post(':id/chat')
  @HttpCode(200)
  @RequirePermission('agent:run')
  async chat(
    @Param('id') id: string,
    @Body() dto: ChatDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { stream, conversationId } = await this.agents.chat(id, req.user, dto);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 先发 conversationId
    res.write(`data: ${JSON.stringify({ conversationId })}\n\n`);

    // thinking 心跳：首个 delta 到达前每 800ms 推一次，避免前端长时间无反馈
    // （必须是 JSON 事件而非 SSE 注释——注释会被前端 fetch reader 过滤掉）
    let heartbeat: NodeJS.Timeout | null = setInterval(() => {
      res.write(`data: ${JSON.stringify({ thinking: true })}\n\n`);
    }, 800);
    const clearHeartbeat = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    stream.on('data', (chunk: Buffer) => {
      clearHeartbeat();
      res.write(chunk);
    });
    stream.on('end', () => {
      clearHeartbeat();
      res.end();
    });
    stream.on('error', (err: any) => {
      clearHeartbeat();
      res.write(
        `data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`,
      );
      res.end();
    });
    res.on('close', clearHeartbeat); // 用户断连兜底
  }
}