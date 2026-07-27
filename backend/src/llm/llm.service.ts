import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';
import { join } from 'path';
import { readFile } from 'fs/promises';
import {
  CreateLlmProviderDto,
  UpdateLlmProviderDto,
} from './dto/create-provider.dto';
import { createOpenAICompatibleChatModel } from './adapters/openai-compatible.adapter';
import { ChatEngine } from './engines/chat-engine';

/** 序列化输出：API Key 只回显末尾 4 位 */
function toPublic(p: any, maskedKey: string) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    providerType: p.providerType,
    baseUrl: p.baseUrl,
    apiKeyMasked: maskedKey,
    models: p.models,
    defaultModel: p.defaultModel,
    isDefault: p.isDefault,
    status: p.status,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

@Injectable()
export class LlmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly chatEngine: ChatEngine,
  ) {}

  private readonly logger = new Logger(LlmService.name);

  /** 当前组织可用的 Provider 列表（API Key 仅回显末尾 4 位） */
  async list(organizationId: string) {
    const items = await this.prisma.llmProvider.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return items.map((p) => toPublic(p, this.encryption.mask(this.encryption.decrypt(p.apiKeyEncrypted))));
  }

  async findOne(id: string, organizationId: string) {
    const p = await this.prisma.llmProvider.findFirst({
      where: { id, organizationId },
    });
    if (!p) throw new NotFoundException('Provider 不存在');
    return toPublic(p, this.encryption.mask(this.encryption.decrypt(p.apiKeyEncrypted)));
  }

  async create(organizationId: string, dto: CreateLlmProviderDto) {
    // 同一组织下唯一性
    const dup = await this.prisma.llmProvider.findFirst({
      where: { organizationId, name: dto.name },
    });
    if (dup) throw new ConflictException(`Provider 名称已存在：${dto.name}`);

    // 若标记为默认，先把其它默认取消
    if (dto.isDefault) {
      await this.prisma.llmProvider.updateMany({
        where: { organizationId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await this.prisma.llmProvider.create({
      data: {
        organizationId,
        name: dto.name,
        providerType: dto.providerType as any,
        baseUrl: dto.baseUrl,
        apiKeyEncrypted: this.encryption.encrypt(dto.apiKey),
        models: dto.models,
        defaultModel: dto.defaultModel ?? dto.models[0],
        isDefault: dto.isDefault ?? false,
        status: 'active',
      },
    });
    return toPublic(created, this.encryption.mask(this.encryption.decrypt(created.apiKeyEncrypted)));
  }

  async update(id: string, organizationId: string, dto: UpdateLlmProviderDto) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Provider 不存在');

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.providerType !== undefined) data.providerType = dto.providerType;
    if (dto.baseUrl !== undefined) data.baseUrl = dto.baseUrl;
    if (dto.apiKey !== undefined) data.apiKeyEncrypted = this.encryption.encrypt(dto.apiKey);
    if (dto.models !== undefined) data.models = dto.models;
    if (dto.defaultModel !== undefined) data.defaultModel = dto.defaultModel;
    if (dto.status !== undefined) data.status = dto.status;

    // 标记为默认时，先取消同组其它默认
    if (dto.isDefault === true) {
      await this.prisma.llmProvider.updateMany({
        where: { organizationId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      });
      data.isDefault = true;
    } else if (dto.isDefault === false) {
      data.isDefault = false;
    }

    const updated = await this.prisma.llmProvider.update({ where: { id }, data });
    return toPublic(updated, this.encryption.mask(this.encryption.decrypt(updated.apiKeyEncrypted)));
  }

  async delete(id: string, organizationId: string) {
    const existing = await this.prisma.llmProvider.findFirst({
      where: { id, organizationId },
    });
    if (!existing) throw new NotFoundException('Provider 不存在');
    await this.prisma.llmProvider.delete({ where: { id } });
    return { success: true };
  }

  /** 测试 Provider 是否可用（发一条最小消息） */
  async test(id: string, organizationId: string) {
    const p = await this.prisma.llmProvider.findFirst({
      where: { id, organizationId },
    });
    if (!p) throw new NotFoundException('Provider 不存在');

    const apiKey = this.encryption.decrypt(p.apiKeyEncrypted);
    const model = p.defaultModel || p.models[0];
    const start = Date.now();
    try {
      const llm = createOpenAICompatibleChatModel({
        providerType: p.providerType,
        baseUrl: p.baseUrl,
        apiKey,
        model,
        temperature: 0,
        maxTokens: 8,
      });
      const res = await llm.invoke([{ role: 'user', content: 'hi' }]);
      return {
        success: true,
        latencyMs: Date.now() - start,
        reply: typeof res.content === 'string' ? res.content : JSON.stringify(res.content),
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: err?.message || String(err),
      };
    }
  }

  /** 内部用：取出解密的 Provider 配置 */
  async getDecrypted(id: string) {
    const p = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Provider 不存在');
    return {
      ...p,
      apiKey: this.encryption.decrypt(p.apiKeyEncrypted),
    };
  }

  /** 内部用：创建 ChatModel（流式） */
  createChatModel(p: {
    providerType: string;
    baseUrl: string;
    apiKey: string;
    defaultModel: string | null;
    models: string[];
  }, modelName?: string) {
    return createOpenAICompatibleChatModel({
      providerType: p.providerType,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: modelName || p.defaultModel || p.models[0],
      streaming: true,
      temperature: 0.7,
    });
  }

  /** 取组织内默认 Provider（解密后） */
  async getDefault(organizationId: string) {
    const p = await this.prisma.llmProvider.findFirst({
      where: { organizationId, isDefault: true, status: 'active' },
    });
    if (!p) {
      // 兜底：取该组织第一个 active 的
      const fallback = await this.prisma.llmProvider.findFirst({
        where: { organizationId, status: 'active' },
      });
      if (!fallback) return null;
      return {
        ...fallback,
        apiKey: this.encryption.decrypt(fallback.apiKeyEncrypted),
      };
    }
    return {
      ...p,
      apiKey: this.encryption.decrypt(p.apiKeyEncrypted),
    };
  }

  /**
   * 通用对话（不绑定 Agent，用默认 Provider 直接聊，支持会话持久化 + 文件上传）
   * 返回 { stream, conversationId }，stream 是 SSE 可读流
   */
  async chat(
    organizationId: string,
    userId: string,
    message: string,
    conversationId?: string,
    attachments: { url: string; name: string; type: string; size: number }[] = [],
  ) {
    const provider = await this.getDefault(organizationId);
    if (!provider) {
      const err: any = new Error('尚未配置可用的模型提供商');
      err.status = 400;
      throw err;
    }

    // 1) 加载或创建 conversation（智能对话不绑 agent）
    if (!conversationId) {
      const conv = await this.prisma.conversation.create({
        data: {
          organizationId,
          userId,
          agentId: null,
          title: message.slice(0, 30),
          lastMessageAt: new Date(),
        },
      });
      conversationId = conv.id;
    } else {
      const exists = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId, agentId: null },
      });
      if (!exists) throw new ForbiddenException('无权访问该会话');
    }

    // 2) 先保存 user 消息（含附件元数据，必须在加载历史之前）
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: message,
        attachments: attachments.length ? (attachments as any) : undefined,
      },
    });

    // 3) 加载历史（user 消息此时已在库中）
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    // 3.5) 把本次上传的附件构造成多模态 content（图片→base64；文档→文本提示）
    //      仅作用于传给 LLM 的 history 最后一条，库里仍存纯文本 + attachments JSON
    if (attachments.length) {
      const multimodal = await this.buildUserContent(message, attachments);
      (msgs[msgs.length - 1] as any).content = multimodal;
    }

    // 4) 创建 chatModel + 流式生成
    const llm = this.createChatModel({
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      defaultModel: provider.defaultModel,
      models: provider.models,
    });
    const { stream, getAccumulated } = await this.chatEngine.streamChat({
      llm,
      history: msgs as any,
    });

    // 5) 流结束后异步保存 assistant 消息 + 更新 lastMessageAt
    //    注意：stream.on('end') 是异步 listener，必须 try-catch，
    //    否则 unhandled promise rejection 会让 Node 进程崩溃。
    //    常见 expected 错误：用户在流式期间 DELETE 了 conversation。
    stream.on('end', () => {
      void (async () => {
        const fullText = getAccumulated();
        if (!fullText) return;
        try {
          await this.prisma.message.create({
            data: { conversationId, role: 'assistant', content: fullText },
          });
          await this.prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date() },
          });
        } catch (err: any) {
          // P2025 (conversation not found) 是用户 DELETE 引发的正常并发，无需告警
          if (err?.code === 'P2025') {
            this.logger.debug(`conversation ${conversationId} was deleted during streaming, skip persist`);
          } else {
            this.logger.error(`[LlmService] failed to persist assistant message: ${err?.message}`);
          }
        }
      })();
    });

    return { stream, conversationId };
  }

  /**
   * 把用户上传的附件构造成 LLM 可理解的多模态 content
   * - 图片：本地读盘 → base64 data URL（避免云端模型访问不了 localhost）
   * - 文档：把文件名作为文本提示拼进 prompt
   */
  private async buildUserContent(
    message: string,
    attachments: { url: string; name: string; type: string; size: number }[],
  ): Promise<string | any[]> {
    const text = message?.trim() || '(用户上传了以下文件，请参考附件内容进行回复)';
    const imageParts: any[] = [];
    for (const a of attachments) {
      if (a.type?.startsWith('image/')) {
        try {
          const fileName = a.url.split('/').pop();
          if (!fileName) continue;
          const filePath = join(process.cwd(), 'uploads', fileName);
          const buf = await readFile(filePath);
          const b64 = buf.toString('base64');
          imageParts.push({
            type: 'image_url',
            image_url: { url: `data:${a.type};base64,${b64}` },
          });
        } catch (e: any) {
          this.logger.warn(`读取图片附件失败 ${a.url}: ${e?.message}`);
        }
      }
    }
    if (imageParts.length) {
      return [{ type: 'text', text }, ...imageParts];
    }
    // 无图片：把文档名作为文本上下文提示
    const names = attachments.map((a) => a.name).join('、');
    return `${text}\n\n[用户上传了文件：${names}]`;
  }

  /**
   * 列出会话（智能对话专用：agentId IS NULL）
   * 按 lastMessageAt desc 排序
   */
  async listConversations(userId: string, organizationId: string) {
    // 不再过滤 agentId：智能对话页统一展示三种模式的会话
    // （纯 LLM：agentId/workflowId 均空；智能体：agentId 非空；工作流：workflowId 非空）
    return this.prisma.conversation.findMany({
      where: { userId, organizationId },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        createdAt: true,
        workflowId: true, // 工作流模式对话会带这个字段
        agentId: true, // 智能体模式对话会带这个字段
      },
      take: 50,
    });
  }

  /**
   * 获取会话历史消息
   */
  async getConversationMessages(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new ForbiddenException('无权访问该会话');
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });
  }

  /**
   * 删除会话（级联删消息）
   */
  async deleteConversation(conversationId: string, userId: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conv) throw new ForbiddenException('无权访问该会话');
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    return { success: true };
  }
}