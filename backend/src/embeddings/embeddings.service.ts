import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/services/encryption.service';
import { PROVIDER_DEFAULTS } from '../llm/adapters/openai-compatible.adapter';

/** 单次请求允许的最大文本数（OpenAI /embeddings 限制） */
const MAX_BATCH = 100;
/** 单条文本长度上限（字符），超过则截断（避免超 token 限制） */
const MAX_TEXT_LEN = 8000;
/** 单次请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 60_000;

export interface EmbeddingResult {
  /** 输入文本数组 */
  input: string[];
  /** 对应的向量数组（按顺序） */
  vectors: number[][];
  /** 使用的模型名 */
  model: string;
  /** Provider 名 */
  providerName: string;
  /** 总耗时（毫秒） */
  durationMs: number;
}

/**
 * Embedding 服务
 * - 复用 LlmProvider（不引入新表、不动 seed），从 organizationId 校验 Provider 归属
 * - 走 OpenAI 兼容 /v1/embeddings 协议（OpenAI / DeepSeek / 通义千问 / 智谱 / MiniMax / Ollama 等均支持）
 * - 自动批处理（每批 ≤ MAX_BATCH），单条文本过长时截断
 * - 失败重试 1 次（应对瞬时网络抖动）
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * 把一组文本转成向量（自动批处理）
   * @param providerId LlmProvider.id
   * @param organizationId 组织 ID（用于校验 Provider 归属当前组织）
   * @param model 模型名（如 text-embedding-3-small）
   * @param input 输入文本数组（不能为空；单个查询用 embedQuery 即可）
   * @param purpose 用途标记（影响 MiniMax 的 type 字段：'db' 存库 / 'query' 检索；OpenAI 等可忽略）
   */
  async embed(
    providerId: string,
    organizationId: string,
    model: string,
    input: string[],
    purpose: 'db' | 'query' = 'db',
  ): Promise<EmbeddingResult> {
    if (!Array.isArray(input) || input.length === 0) {
      throw new Error('Embedding input 不能为空');
    }

    const provider = await this.loadProvider(providerId, organizationId);

    const t0 = Date.now();
    const vectors: number[][] = [];
    for (let i = 0; i < input.length; i += MAX_BATCH) {
      const batch = input.slice(i, i + MAX_BATCH).map((s) => this.truncate(s));
      const batchVecs = await this.callEmbeddingsApi(
        provider.providerType,
        provider.baseUrl,
        provider.apiKey,
        model,
        batch,
        purpose,
      );
      vectors.push(...batchVecs);
    }

    return {
      input,
      vectors,
      model,
      providerName: provider.name,
      durationMs: Date.now() - t0,
    };
  }

  /**
   * 单条查询的便捷方法（多数向量检索只查一条）
   * 自动用 purpose='query'（MiniMax 检索场景）
   */
  async embedQuery(
    providerId: string,
    organizationId: string,
    model: string,
    text: string,
  ): Promise<number[]> {
    const r = await this.embed(providerId, organizationId, model, [text], 'query');
    return r.vectors[0];
  }

  // ===== 私有 =====

  /** 加载并校验 Provider 属于当前组织，返回解密的 baseUrl/apiKey/name */
  private async loadProvider(providerId: string, organizationId: string) {
    const p = await this.prisma.llmProvider.findFirst({
      where: { id: providerId, organizationId },
    });
    if (!p) {
      throw new ForbiddenException('指定的模型提供商不存在或无权访问');
    }
    if (p.status !== 'active') {
      throw new ForbiddenException(`模型提供商「${p.name}」已停用`);
    }
    return {
      name: p.name,
      providerType: p.providerType as string,
      baseUrl:
        p.baseUrl ||
        (p.providerType ? PROVIDER_DEFAULTS[p.providerType as string]?.baseUrl : undefined) ||
        'https://api.openai.com/v1',
      apiKey: this.encryption.decrypt(p.apiKeyEncrypted),
    };
  }

  /** 截断过长的单条文本（按字符；英文 1 字符 ≈ 0.3 token，中文 1 字符 ≈ 1 token） */
  private truncate(s: string): string {
    if (!s || typeof s !== 'string') return '';
    return s.length > MAX_TEXT_LEN ? s.slice(0, MAX_TEXT_LEN) : s;
  }

  /**
   * 调用 /embeddings 端点
   * - 标准 OpenAI 协议（OpenAI / DeepSeek / 通义千问 / 智谱 / Ollama）：
   *     请求 { model, input: [...] }，响应 { data: [{ embedding: number[] }, ...] }
   * - MiniMax 协议（国际版 minimaxi.com）：
   *     请求 { model, texts: [...], type: 'db'|'query' }，响应 { vectors: number[][] }
   */
  private async callEmbeddingsApi(
    providerType: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    input: string[],
    purpose: 'db' | 'query',
  ): Promise<number[][]> {
    const url = `${baseUrl.replace(/\/$/, '')}/embeddings`;
    const isMiniMax = providerType === 'MiniMax';
    const body = JSON.stringify(
      isMiniMax
        ? { model, texts: input, type: purpose }
        : { model, input },
    );

    const doFetch = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body,
          signal: ctrl.signal,
        });
        const txt = await res.text().catch(() => '');
        if (!res.ok) {
          throw new Error(
            `Embedding API 失败 ${res.status} ${res.statusText}: ${txt.slice(0, 300)}`,
          );
        }
        const json: any = JSON.parse(txt);
        return isMiniMax
          ? this.parseMiniMaxResponse(json, input.length)
          : this.parseOpenAIResponse(json, input.length);
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      return await doFetch();
    } catch (err: any) {
      // 瞬时错误重试一次
      if (err?.name === 'AbortError') throw err;
      this.logger.warn(
        `Embedding API 第一次失败，1s 后重试: ${err?.message || err}`,
      );
      await new Promise((r) => setTimeout(r, 1000));
      return await doFetch();
    }
  }

  /** OpenAI 标准响应：{ data: [{ embedding: number[] }, ...] } */
  private parseOpenAIResponse(json: any, expected: number): number[][] {
    const data = json?.data;
    if (!Array.isArray(data) || data.length !== expected) {
      throw new Error(
        `Embedding API 返回格式异常（data 长度=${data?.length}，期望=${expected}）`,
      );
    }
    return data.map((d: any) => d.embedding as number[]);
  }

  /** MiniMax 响应：{ vectors: number[][], base_resp: {status_code, status_msg} } */
  private parseMiniMaxResponse(json: any, expected: number): number[][] {
    // MiniMax 出错时 vectors: null，base_resp.status_code !== 0
    const base = json?.base_resp;
    if (base && base.status_code !== 0) {
      throw new Error(
        `MiniMax Embedding 失败 (code=${base.status_code}): ${base.status_msg || 'unknown'}`,
      );
    }
    const vectors = json?.vectors;
    if (!Array.isArray(vectors) || vectors.length !== expected) {
      throw new Error(
        `MiniMax Embedding 返回格式异常（vectors 长度=${vectors?.length}，期望=${expected}）`,
      );
    }
    return vectors as number[][];
  }
}