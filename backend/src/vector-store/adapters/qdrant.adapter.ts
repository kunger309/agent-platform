import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VectorStoreAdapter,
  VectorPoint,
  SearchHit,
  SearchOptions,
  VectorDistance,
  VectorPayload,
  collectionNameFor,
  toQdrantUuid,
} from '../vector-store.types';

/**
 * Qdrant 适配器（REST API，不依赖官方 SDK）。
 *
 * 选用 REST 而非 SDK 的原因：
 * - 官方 SDK 会把运行时拉到 ~10MB（proto + grpc-web 等）；
 * - 我们只需要 6 个动作（CRUD collection / CRUD points / search），REST 足够；
 * - 减少依赖，方便后续接 Milvus / Weaviate 时再换。
 *
 * 协议版本：Qdrant v1.18+。
 * 文档：https://qdrant.tech/documentation/concepts/points/
 */
@Injectable()
export class QdrantAdapter implements VectorStoreAdapter {
  readonly name = 'qdrant';
  private readonly logger = new Logger(QdrantAdapter.name);
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly batchSize = 100;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (this.config.get<string>('QDRANT_URL') || 'http://localhost:6334').replace(/\/$/, '');
    this.apiKey = this.config.get<string>('QDRANT_API_KEY');
  }

  // ============================================================
  // collection 管理
  // ============================================================

  async ensureCollection(
    knowledgeBaseId: string,
    dim: number,
    distance: VectorDistance = 'Cosine',
  ): Promise<void> {
    const name = collectionNameFor(knowledgeBaseId);
    // 1) 看 collection 是否已存在（404 → 不存在，继续创建）
    const exists = await this.collectionExists(name);
    if (exists) {
      this.logger.debug(`collection ${name} 已存在，跳过创建`);
      return;
    }
    // 2) 不存在则创建
    //    注意：多文档并发首次上传同一 KB 时，多个 processDocument 会同时走到这里，
    //    存在 TOCTOU 竞态——都先 GET 到"不存在"再并发 PUT，后者会拿到 409。
    //    因此把 409 视为"已被并发创建"并正常返回（幂等）。
    try {
      await this.request('PUT', `/collections/${name}`, {
        vectors: { size: dim, distance, on_disk: true },
        // payload 字段加索引，方便后续按 documentId / orgId 高效 filter
        // 注意：Qdrant 索引创建是异步的，但不影响 upsert / search 的正确性
        optimizers_config: { default_segment_number: 2 },
      });
      this.logger.log(`✅ collection ${name} 已创建 (dim=${dim}, distance=${distance})`);
    } catch (err: any) {
      if (err?.status === 409) {
        this.logger.debug(`collection ${name} 被并发创建（409），视为已存在`);
      } else {
        throw err;
      }
    }
    // 3) 关键字段建 payload index（避免后续 search 报 "Index required"）
    await this.createPayloadIndexes(name, [
      'organizationId',
      'documentId',
      'chunkIndex',
    ]);
  }

  /** collection 是否存在（不抛错） */
  private async collectionExists(name: string): Promise<boolean> {
    try {
      const res = await this.request<{ result?: any }>(
        'GET',
        `/collections/${name}`,
      );
      // Qdrant v1.18 返回 { result: {...}, status: "ok" }
      return res?.result !== undefined && res?.result !== null;
    } catch (err: any) {
      if (err?.status === 404) return false;
      throw err;
    }
  }

  async deleteCollection(knowledgeBaseId: string): Promise<void> {
    const name = collectionNameFor(knowledgeBaseId);
    try {
      await this.request('DELETE', `/collections/${name}`);
      this.logger.log(`🗑️  collection ${name} 已删除`);
    } catch (err: any) {
      // 不存在不算错
      if (err?.status === 404) return;
      throw err;
    }
  }

  // ============================================================
  // 点管理
  // ============================================================

  async upsert(knowledgeBaseId: string, points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    const name = collectionNameFor(knowledgeBaseId);

    // 分批，避免单次请求 body 过大
    for (let i = 0; i < points.length; i += this.batchSize) {
      const batch = points.slice(i, i + this.batchSize);
      const body = {
        points: batch.map((p) => ({
          // Qdrant 不接受字符串 id，转换成确定性 UUID
          id: toQdrantUuid(p.id),
          vector: p.vector,
          payload: {
            ...p.payload,
            // 原始 chunk.id 也保留在 payload 里，方便业务层反查
            chunkId: p.id,
          },
        })),
        // wait=true 让 upsert 落盘后再返回，确保后续 search 能查到
        wait: true,
      };
      await this.request('PUT', `/collections/${name}/points`, body);
    }
    this.logger.debug(`upserted ${points.length} points into ${name}`);
  }

  async deletePoints(knowledgeBaseId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const name = collectionNameFor(knowledgeBaseId);
    // 把业务 id 转成 Qdrant UUID 数组
    const qdrantIds = ids.map(toQdrantUuid);
    await this.request('POST', `/collections/${name}/points/delete`, {
      points: qdrantIds,
      wait: true,
    });
  }

  async deleteByDocument(knowledgeBaseId: string, documentId: string): Promise<void> {
    const name = collectionNameFor(knowledgeBaseId);
    // Filter 选择器：把所有 payload.documentId == X 的点都删了
    await this.request('POST', `/collections/${name}/points/delete`, {
      filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
      wait: true,
    });
    this.logger.debug(`deleted points of documentId=${documentId} in ${name}`);
  }

  // ============================================================
  // 检索
  // ============================================================

  async search(
    knowledgeBaseId: string,
    organizationId: string,
    vector: number[],
    options: SearchOptions = {},
  ): Promise<SearchHit[]> {
    const {
      topK = 5,
      scoreThreshold,
      filter = {},
      withOrgFilter = true,
    } = options;

    const name = collectionNameFor(knowledgeBaseId);

    // 防御性 filter：必须传 orgId 匹配 + 用户传的额外 filter
    const mustClauses: any[] = [];
    if (withOrgFilter) {
      mustClauses.push({
        key: 'organizationId',
        match: { value: organizationId },
      });
    }
    for (const [k, v] of Object.entries(filter)) {
      mustClauses.push({ key: k, match: { value: v } });
    }

    const body: any = {
      vector,
      limit: topK,
      with_payload: true,
      with_vector: false,
      score_threshold: scoreThreshold,
    };
    if (mustClauses.length > 0) {
      body.filter = { must: mustClauses };
    }

    const result = await this.request<{ result: any[] }>(
      'POST',
      `/collections/${name}/points/search`,
      body,
    );

    return (result?.result || []).map((r) => ({
      id: r.payload?.chunkId || String(r.id),
      score: r.score,
      payload: r.payload as VectorPayload,
    }));
  }

  // ============================================================
  // 健康检查
  // ============================================================

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await this.request<{ title: string }>('GET', '/');
      if (res?.title?.includes('qdrant')) return { ok: true };
      return { ok: false, detail: 'unexpected response' };
    } catch (err: any) {
      return { ok: false, detail: err?.message || String(err) };
    }
  }

  // ============================================================
  // 内部工具
  // ============================================================

  /** 统一 HTTP 请求封装 */
  private async request<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: any,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['api-key'] = this.apiKey;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        // Qdrant 大批 upsert 偶尔会慢，给宽一点超时
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err: any) {
      throw new Error(`Qdrant ${method} ${path} 请求失败: ${err.message}`);
    }

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // 非 JSON 响应保留原文
    }

    if (!res.ok) {
      const err: any = new Error(
        `Qdrant ${method} ${path} 失败: ${res.status} ${data?.status?.error || text?.slice(0, 200)}`,
      );
      err.status = res.status;
      err.body = data;
      throw err;
    }

    return data as T;
  }

  /** 为关键 payload 字段加索引（filter 必备） */
  private async createPayloadIndexes(
    collectionName: string,
    fields: string[],
  ): Promise<void> {
    for (const field of fields) {
      try {
        await this.request(
          'PUT',
          `/collections/${collectionName}/index`,
          {
            field_name: field,
            field_schema: 'keyword',
          },
        );
      } catch (err: any) {
        // 已存在 / 已建索引：忽略
        if (err?.status === 400 || err?.body?.status?.error?.includes('exists')) {
          continue;
        }
        this.logger.warn(
          `payload index ${field} 创建失败: ${err.message}`,
        );
      }
    }
  }
}