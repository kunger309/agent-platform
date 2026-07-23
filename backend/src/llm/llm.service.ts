import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';
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
   * 通用对话（不绑定 Agent，用默认 Provider 直接聊）
   * 返回 SSE 可读流
   */
  async chat(organizationId: string, message: string, history: Array<{ role: string; content: string }> = []) {
    const provider = await this.getDefault(organizationId);
    if (!provider) {
      const err: any = new Error('尚未配置可用的 LLM Provider');
      err.status = 400;
      throw err;
    }
    const llm = this.createChatModel({
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      defaultModel: provider.defaultModel,
      models: provider.models,
    });
    // 当前消息必须作为最后一条 user 消息加入历史（否则 MiniMax 等报 messages is empty）
    const fullHistory = [
      ...history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      { role: 'user' as const, content: message },
    ];
    return this.chatEngine.streamChat({ llm, history: fullHistory });
  }
}