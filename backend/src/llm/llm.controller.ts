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
import { LlmService } from './llm.service';
import {
  CreateLlmProviderDto,
  UpdateLlmProviderDto,
} from './dto/create-provider.dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('llm-providers')
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Get()
  @RequirePermission('provider:list')
  async list(@Request() req: any) {
    const orgId = req.user.currentOrgId;
    const data = await this.llm.list(orgId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('provider:list')
  async detail(@Param('id') id: string, @Request() req: any) {
    const data = await this.llm.findOne(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('provider:create')
  async create(@Body() dto: CreateLlmProviderDto, @Request() req: any) {
    const data = await this.llm.create(req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('provider:edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLlmProviderDto,
    @Request() req: any,
  ) {
    const data = await this.llm.update(id, req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('provider:edit')
  async delete(@Param('id') id: string, @Request() req: any) {
    return this.llm.delete(id, req.user.currentOrgId);
  }

  @Post(':id/test')
  @RequirePermission('provider:list')
  async test(@Param('id') id: string, @Request() req: any) {
    const data = await this.llm.test(id, req.user.currentOrgId);
    return { success: data.success, data };
  }
}

/**
 * 通用对话端点（不绑定 Agent，用默认 Provider 直接聊）
 * SSE 流式输出
 */
@Controller('chat')
export class ChatController {
  constructor(private readonly llm: LlmService) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('agent:run')
  async chat(
    @Body() body: { message: string; history?: Array<{ role: string; content: string }> },
    @Request() req: any,
    @Res() res: Response,
  ) {
    if (!body?.message?.trim()) {
      return res.status(400).json({ success: false, message: 'message 不能为空' });
    }

    const { stream } = await this.llm.chat(
      req.user.currentOrgId,
      body.message,
      body.history || [],
    );

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    stream.on('data', (chunk: Buffer) => res.write(chunk));
    stream.on('end', () => res.end());
    stream.on('error', (err: any) => {
      res.write(`data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`);
      res.end();
    });
  }
}
