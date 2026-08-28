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
import { RetrieversService } from '../retrievers/retrievers.service';

/**
 * 容错解密：解密/Tag 校验失败时打 warn 并把字段标记为失败，
 * 不让单条记录拖垮整个 list/findOne。
 * 触发场景：ENCRYPTION_KEY 与历史数据不兼容（典型：密钥轮换或迁移后）。
 */
function safeDecryptAndMask(
  encryption: EncryptionService,
  logger: Logger,
  p: any,
): { masked: string; failed: boolean } {
  try {
    if (!p.apiKeyEncrypted) return { masked: '', failed: false };
    const plain = encryption.decrypt(p.apiKeyEncrypted);
    return { masked: encryption.mask(plain), failed: false };
  } catch (err: any) {
    logger.warn(
      `[LlmService] decrypt failed for provider "${p?.name}" (${p?.id}): ${err?.message}. ` +
        '通常是 ENCRYPTION_KEY 与历史数据不兼容，请提示用户在 UI 重新配置 API Key。',
    );
    return {
      masked: '🔒 [解密失败，请重新配置 API Key]',
      failed: true,
    };
  }
}

/** 序列化输出：API Key 只回显末尾 4 位；解密失败时输出占位 + 失败标记 */
function toPublic(
  p: any,
  maskedKey: string,
  apiKeyDecryptFailed = false,
) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    providerType: p.providerType,
    baseUrl: p.baseUrl,
    apiKeyMasked: maskedKey,
    apiKeyDecryptFailed,
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
    private readonly retrievers: RetrieversService,
  ) {}

  private readonly logger = new Logger(LlmService.name);

  /** 当前组织可用的 Provider 列表（API Key 仅回显末尾 4 位，解密失败仅影响该条） */
  async list(organizationId: string) {
    const items = await this.prisma.llmProvider.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return items.map((p) => {
      const { masked, failed } = safeDecryptAndMask(this.encryption, this.logger, p);
      return toPublic(p, masked, failed);
    });
  }

  async findOne(id: string, organizationId: string) {
    const p = await this.prisma.llmProvider.findFirst({
      where: { id, organizationId },
    });
    if (!p) throw new NotFoundException('Provider 不存在');
    const { masked, failed } = safeDecryptAndMask(this.encryption, this.logger, p);
    return toPublic(p, masked, failed);
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
    const { masked, failed } = safeDecryptAndMask(this.encryption, this.logger, created);
    return toPublic(created, masked, failed);
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
    const { masked, failed } = safeDecryptAndMask(this.encryption, this.logger, updated);
    return toPublic(updated, masked, failed);
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
   * 通用对话（不绑定 Agent，用默认 Provider 直接聊，支持会话持久化 + 文件上传 + KB 检索注入）
   * 返回 { stream, conversationId, sources }，stream 是 SSE 可读流
   * - kbIds 非空时，自动对每个 KB 做混合检索，把命中片段拼成 systemPrompt 一并送给 LLM。
   *   sources 是 [{ kbId, kbName, documentId, documentName, chunkIndex, content, score, vectorScore, bm25Score, sources }]
   *   前端 chat 用 sources 在气泡下挂「参考 N 段资料」展开面板。
   */
  async chat(
    organizationId: string,
    userId: string,
    message: string,
    conversationId?: string,
    attachments: { url: string; name: string; type: string; size: number }[] = [],
    kbIds?: string[],
  ) {
    const provider = await this.getDefault(organizationId);
    if (!provider) {
      const err: any = new Error('尚未配置可用的模型提供商');
      err.status = 400;
      throw err;
    }

    // 1) 加载或创建 conversation（智能对话不绑 agent）。
    // kbIds 为 undefined 表示旧客户端未传，沿用已保存关联；显式 [] 表示清空关联。
    const requestedKbIds = kbIds === undefined
      ? undefined
      : [...new Set(kbIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim()))];
    let resolvedKbIds = requestedKbIds ?? [];

    if (!conversationId) {
      const conv = await this.prisma.conversation.create({
        data: {
          organizationId,
          userId,
          agentId: null,
          workflowId: null,
          kbIds: resolvedKbIds,
          title: message.slice(0, 30),
          lastMessageAt: new Date(),
        },
      });
      conversationId = conv.id;
    } else {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId, organizationId, agentId: null, workflowId: null },
        select: { id: true, kbIds: true },
      });
      if (!existing) throw new ForbiddenException('无权访问该会话');

      resolvedKbIds = requestedKbIds ?? existing.kbIds;
      // 用户消息一到达就刷新排序时间；无需等待 assistant 流结束，刷新页面也能立即排到首位。
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          ...(requestedKbIds !== undefined ? { kbIds: resolvedKbIds } : {}),
        },
      });
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

    // 3.6) KB 检索注入：对每个 kbId 做混合检索（向量+BM25+RRF），
    //      拼成 systemPrompt 一并送给 LLM；同时收集 sources 用于前端展示。
    //      失败不抛错（KB 删了/没权限时不影响主对话），warn 日志 + sources 标注 error。
    let systemPromptFromKb: string | undefined;
    let sources: any[] = [];
    if (resolvedKbIds.length) {
      const blocks: string[] = [];
      for (const kbId of resolvedKbIds) {
        try {
          const ret = await this.retrievers.retrieve(organizationId, kbId, message, {
            topK: 5,
            scoreThreshold: 0,
          });
          // 反查 KB 名称（用于 sources 展示）
          let kbName = kbId;
          try {
            const kb = await this.prisma.knowledgeBase.findFirst({
              where: { id: kbId, organizationId },
              select: { id: true, name: true },
            });
            if (kb) kbName = kb.name;
          } catch { /* 名称查不到也不影响主流程 */ }

          if (!ret.results.length) {
            blocks.push(`[知识库 "${kbName}"] 未命中任何内容。`);
            continue;
          }
          const hits = ret.results.map((r, i) => {
            const vec = r.vectorScore != null ? r.vectorScore.toFixed(4) : '-';
            const bm = r.bm25Score != null ? r.bm25Score.toFixed(4) : '-';
            return `[${i + 1}] (RRF=${r.score.toFixed(4)}, vec=${vec}, bm25=${bm})\n${(r.content || '').replace(/\s+/g, ' ').trim()}`;
          }).join('\n\n');
          blocks.push(`[知识库 "${kbName}"] 共 ${ret.total} 条命中：\n\n${hits}`);

          // 收集 sources（含 KB 名 + 文档名 + 内容）
          for (const r of ret.results) {
            let documentName = r.documentId || '';
            if (r.documentId) {
              try {
                const doc = await this.prisma.document.findFirst({
                  where: { id: r.documentId, knowledgeBaseId: kbId },
                  select: { name: true, originalName: true },
                });
                if (doc) documentName = doc.originalName || doc.name;
              } catch { /* 文档查不到时回退到 id */ }
            }
            sources.push({
              kbId,
              kbName,
              documentId: r.documentId,
              documentName,
              chunkIndex: r.chunkIndex,
              content: r.content,
              score: r.score,
              vectorScore: r.vectorScore,
              bm25Score: r.bm25Score,
              sources: r.sources,
            });
          }
        } catch (e: any) {
          this.logger.warn(`[LlmService.chat] kb ${kbId} 检索失败: ${e?.message}`);
          sources.push({ kbId, error: e?.message || String(e) });
        }
      }
      if (blocks.length) {
        systemPromptFromKb =
          '你可以参考以下从知识库检索到的资料回答用户问题。' +
          '如果资料里没有相关信息，请明确说明「知识库未命中」并基于你的通用知识回答。\n\n' +
          blocks.join('\n\n---\n\n');
      }
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
      systemPrompt: systemPromptFromKb,
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

    return { stream, conversationId, sources };
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
      orderBy: [
        { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        title: true,
        lastMessageAt: true,
        createdAt: true,
        workflowId: true, // 工作流模式对话会带这个字段
        agentId: true, // 智能体模式对话会带这个字段
        kbIds: true, // 知识库问答关联，前端刷新后恢复 chips 与后续检索
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