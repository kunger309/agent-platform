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
  ForbiddenException,
  UseInterceptors,
  UploadedFiles,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import type { Response } from 'express';
import { LlmService } from './llm.service';
import { PrismaService } from '../database/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
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
 *
 * 支持两种模式（自动按 body.workflowId 路由）：
 *   - 纯 LLM 模式（无 workflowId）：走 LlmService.chat()
 *   - 工作流模式（有 workflowId）：走 WorkflowsService.run()，SSE 事件做兼容映射
 *     （node_token → delta、done → content），用户感受到"跟一个工作流对话"
 */
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);
  constructor(
    private readonly llm: LlmService,
    private readonly prisma: PrismaService,
    // forwardRef：WorkflowsModule ↔ LlmModule 循环依赖
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
  ) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('agent:run')
  @UseInterceptors(chatUploadInterceptor)
  async chat(
    @UploadedFiles() files: any[],
    @Body() body: { message?: string; conversationId?: string; workflowId?: string },
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

    // ===== 模式分支：工作流模式 vs 纯 LLM 模式 =====
    const workflowId = (body?.workflowId || '').trim();
    if (workflowId) {
      return this.chatWithWorkflow(req, res, workflowId, message, body?.conversationId, attachments);
    }

    // ===== 纯 LLM 模式（原行为）=====
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

  /**
   * 工作流模式：把 WorkflowsService.run() 的事件映射成 chat 兼容的 SSE。
   * node_token -> delta；done -> content；error -> error。
   * 用户感受到的就是"跟一个工作流对话"（打字机效果照常）。
   *
   * 注：当前为单轮模式（每次 send 都是新 Execution，不读历史）。
   * 多轮上下文支持需后续把 conversation 消息作为 LLM 节点的 system context 注入。
   */
  private async chatWithWorkflow(
    req: any,
    res: Response,
    workflowId: string,
    message: string,
    conversationId: string | undefined,
    attachments: { url: string; name: string; type: string; size: number }[],
  ) {
    const userId = req.user.userId;
    const orgId = req.user.currentOrgId;

    // 0) 校验工作流存在 + 是 published
    const wf = await this.prisma.workflow.findFirst({
      where: { id: workflowId, organizationId: orgId },
    });
    if (!wf) {
      return res.status(404).json({ success: false, message: '工作流不存在' });
    }

    // 1) 加载或创建 conversation（绑 workflowId）
    if (!conversationId) {
      const conv = await this.prisma.conversation.create({
        data: {
          organizationId: orgId,
          userId,
          workflowId,
          title: `[${wf.name}] ${message.slice(0, 20)}`,
          lastMessageAt: new Date(),
        },
      });
      conversationId = conv.id;
    } else {
      const exists = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId, workflowId },
      });
      if (!exists) throw new ForbiddenException('无权访问该会话或工作流不匹配');
    }

    // 2) 先存 user 消息
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: message,
        attachments: attachments.length ? (attachments as any) : undefined,
      },
    });

    // 3) 准备 SSE
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ conversationId })}\n\n`);

    let keepaliveTimer: NodeJS.Timeout | null = setInterval(() => {
      try {
        res.write(`data: ${JSON.stringify({ thinking: true })}\n\n`);
      } catch {
        /* ignore */
      }
    }, 800);
    const stopKeepalive = () => {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    };
    req.on('close', () => stopKeepalive());

    // 4) 累计 assistant 输出（用于落库）
    let acc = '';
    let runId: string | null = null;

    // 5) 包装 emit：把工作流事件映射成 chat 事件
    //    关键设计：chat 用户只应看到"最终回答"，不应被中间节点的思考/原始 token 干扰。
    //    我们通过 `wf.graphJson.nodes` 找出所有 answer 节点的 id 集合，只透传这些节点的
    //    node_token。其他 LLM / Tool / Condition 等中间节点的 token 直接吞掉（仍落 ExecutionLog）。
    const answerNodeIds = new Set<string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wfNodes = ((wf.graphJson as any)?.nodes || []) as any[];
    for (const n of wfNodes) {
      const nt = n.type || n.data?.nodeType;
      if (nt === 'answer') answerNodeIds.add(n.id);
    }
    const emit = (ev: any) => {
      stopKeepalive();
      try {
        if (ev.type === 'node_token') {
          // 只透传 answer 节点的 token；其他节点（LLM 思考/中间结果）保持沉默
          if (answerNodeIds.has(ev.nodeId)) {
            const text = ev.delta || ev.text || '';
            acc += text;
            res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
          }
        } else if (ev.type === 'done') {
          // 用 chat 原生 done 标志触发前端 onDone；最终内容由 answer 节点的 token 累加得到
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } else if (ev.type === 'error') {
          res.write(`data: ${JSON.stringify({ error: ev.message })}\n\n`);
        }
        // 其他 node_start / node_end / run_start 不暴露给 chat 客户端
        if (ev.runId) runId = ev.runId;
      } catch {
        /* ignore */
      }
    };

    // 6) 运行工作流
    try {
      await this.workflows.run(
        workflowId,
        orgId,
        userId,
        { input: message },
        emit,
        conversationId,
      );
    } catch (e: any) {
      this.logger.error(`[ChatController] chatWithWorkflow failed: ${e?.message}`);
      try {
        res.write(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
      } catch {
        /* ignore */
      }
    }

    // 7) 落库 assistant 消息 + 更新 lastMessageAt
    //    注意：这里兜底——即便 done 事件没收到，也要把 acc / Answer 输出存进去
    const finalText = acc;
    if (finalText) {
      try {
        await this.prisma.message.create({
          data: {
            conversationId,
            role: 'assistant',
            content: finalText,
            runId,
          },
        });
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        });
      } catch (e: any) {
        if (e?.code !== 'P2025') {
          this.logger.error(`[ChatController] persist wf assistant msg failed: ${e?.message}`);
        }
      }
    }

    stopKeepalive();
    res.end();
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
