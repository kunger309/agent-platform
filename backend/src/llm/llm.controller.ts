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
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import type { Response } from 'express';
import { LlmService } from './llm.service';
import {
  CreateLlmProviderDto,
  UpdateLlmProviderDto,
} from './dto/create-provider.dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { Logger } from '@nestjs/common';

// 上传目录：与 main.ts 保持一致（backend/uploads）
const UPLOADS_DIR = join(process.cwd(), 'uploads');
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

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

// 聊天文件上传拦截器（multipart/form-data，字段名 files）
const chatUploadInterceptor = FilesInterceptor('files', 10, {
  storage: diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname) || '';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB/个
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMime = /^image\/(png|jpe?g|webp|gif|bmp|svg\+xml)$/i;
    const allowedExt = /\.(png|jpe?g|webp|gif|bmp|svg|pdf|txt|md|markdown|docx?|csv|json|log)$/i;
    if (allowedMime.test(file.mimetype) || allowedExt.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${file.originalname}`), false);
    }
  },
});

/**
 * 通用对话端点（不绑定 Agent，用默认 Provider 直接聊，支持会话持久化）
 * SSE 流式输出，支持文件上传（multipart/form-data，字段名 files）
 */
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  constructor(private readonly llm: LlmService) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('agent:run')
  @UseInterceptors(chatUploadInterceptor)
  async chat(
    @UploadedFiles() files: any[],
    @Body() body: { message?: string; conversationId?: string },
    @Request() req: any,
    @Res() res: Response,
  ) {
    const message = (body?.message || '').trim();
    // 纯文件上传（无文本）也允许，但两者不能都为空
    if (!message && (!files || files.length === 0)) {
      return res.status(400).json({ success: false, message: 'message 与文件不能都为空' });
    }

    // 把已落盘的文件整理成附件元数据（URL 供前端展示）
    const attachments = (files || []).map((f) => ({
      url: `/uploads/${f.filename}`,
      name: f.originalname,
      type: f.mimetype,
      size: f.size,
    }));

    let chatResult: { stream: any; conversationId: string };
    try {
      chatResult = await this.llm.chat(
        req.user.currentOrgId,
        req.user.userId,
        message,
        body?.conversationId,
        attachments,
      );
    } catch (err: any) {
      this.logger.error(`[ChatController] chat() failed: ${err?.message || err}`);
      // @Res() 模式下异常过滤器不会自动写响应，需手动以 SSE error 事件返回
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(`data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`);
      res.end();
      return;
    }

    const { stream, conversationId } = chatResult;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // 首个事件：把 conversationId 发给前端，让前端能维持会话
    res.write(`data: ${JSON.stringify({ conversationId })}\n\n`);

    // Keepalive：在首个 delta 到达前，每 800ms 给前端推一次
    // {"thinking":true} 事件，作用：
    //   1) 让前端明确知道"模型在思考"，从而展示 loading/typing
    //   2) 防止 vite proxy / nginx / 浏览器 SSE 缓冲超时断连
    let keepaliveTimer: NodeJS.Timeout | null = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ thinking: true })}\n\n`);
      } catch {
        // 连接已断，清掉定时器
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
      }
    }, 800);
    const stopKeepalive = () => {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    };

    stream.on('data', (chunk: Buffer) => {
      stopKeepalive();
      res.write(chunk);
    });
    stream.on('end', () => {
      stopKeepalive();
      res.end();
    });
    stream.on('error', (err: any) => {
      stopKeepalive();
      res.write(`data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`);
      res.end();
    });
    // 客户端主动断连（AbortController）时也要清定时器
    req.on('close', () => stopKeepalive());
  }

  /** 列出当前用户的「智能对话」会话 */
  @Get('conversations')
  @RequirePermission('agent:run')
  async listConversations(@Request() req: any) {
    const data = await this.llm.listConversations(req.user.userId, req.user.currentOrgId);
    return { success: true, data };
  }

  /** 获取某个会话的所有历史消息 */
  @Get('conversations/:id/messages')
  @RequirePermission('agent:run')
  async getMessages(@Param('id') id: string, @Request() req: any) {
    const data = await this.llm.getConversationMessages(id, req.user.userId);
    return { success: true, data };
  }

  /** 删除会话（级联删消息） */
  @Delete('conversations/:id')
  @RequirePermission('agent:run')
  async deleteConversation(@Param('id') id: string, @Request() req: any) {
    const data = await this.llm.deleteConversation(id, req.user.userId);
    return { success: true, data };
  }
}
