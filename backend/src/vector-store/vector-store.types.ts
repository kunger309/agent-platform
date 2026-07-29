/**
 * 向量库抽象层类型。
 *
 * 设计要点：
 * - 每 KB 一个 collection（collection 名 = `kb_<kbId>`），物理隔离最简单，
 *   检索 / 删除 / 重建都不需要 filter by KB。
 * - payload 里仍然冗余存 orgId / documentId，做防御性 filter：
 *   - 跨组织误调用时，orgId 不匹配直接 0 hit；
 *   - 删除文档时按 documentId 一次性删完对应所有点。
 * - 距离度量默认 Cosine（适合 OpenAI / MiniMax 风格的归一化向量）。
 */

export type VectorDistance = 'Cosine' | 'Euclid' | 'Dot';

/** 上传 / 更新一条向量 */
export interface VectorPoint {
  /** 全局唯一 id（推荐使用 DocumentChunk.id），便于 delete-by-id */
  id: string;
  vector: number[];
  payload: VectorPayload;
}

/** point payload：所有 metadata 都进 payload，方便 search 时直接返回 */
export interface VectorPayload {
  organizationId: string;
  knowledgeBaseId: string;
  documentId: string;
  chunkIndex: number;
  pageNumber?: number;
  content: string;
  [k: string]: any;
}

/** 检索返回结构 */
export interface SearchHit {
  id: string;
  score: number;
  payload: VectorPayload;
}

/** 检索参数 */
export interface SearchOptions {
  topK?: number;
  /** 相似度下限（0~1），低于此返回 0 hit */
  scoreThreshold?: number;
  /** 额外 filter：例如 { documentId: 'xxx' } */
  filter?: Record<string, any>;
  /** 是否强制 orgId 一致（默认 true，防止误调用跨租户检索） */
  withOrgFilter?: boolean;
}

/** 适配器接口：每个 provider 一份实现 */
export interface VectorStoreAdapter {
  /** provider 名称（用于日志 / 健康检查） */
  readonly name: string;

  /** 创建 collection（如已存在则跳过） */
  ensureCollection(
    knowledgeBaseId: string,
    dim: number,
    distance?: VectorDistance,
  ): Promise<void>;

  /** 删除整个 collection（删 KB 时调用） */
  deleteCollection(knowledgeBaseId: string): Promise<void>;

  /** 批量 upsert 点（内部按批次切分，默认 100/batch） */
  upsert(knowledgeBaseId: string, points: VectorPoint[]): Promise<void>;

  /** 删除指定 id 的点（重建 / 修正某 chunk 时） */
  deletePoints(knowledgeBaseId: string, ids: string[]): Promise<void>;

  /** 删除某文档的所有点（删文档时调用） */
  deleteByDocument(knowledgeBaseId: string, documentId: string): Promise<void>;

  /** 检索 */
  search(
    knowledgeBaseId: string,
    organizationId: string,
    vector: number[],
    options?: SearchOptions,
  ): Promise<SearchHit[]>;

  /** 健康检查（不抛错即可） */
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * collection 名规范：kb_<kbId>
 * Qdrant 限制：collection 名只允许 [a-zA-Z0-9_-]，最长 255
 */
export function collectionNameFor(kbId: string): string {
  return `kb_${kbId}`;
}

/**
 * 把任意字符串 ID 转成 Qdrant 接受的 UUID v5（确定性）。
 *
 * 背景：Qdrant v1.18 只接受 u64 或 UUID 作为 point id，不能直接用 cuid。
 * 我们用 SHA-1 哈希字符串，再按 RFC 4122 改写 version/variant 位，
 * 得到一个确定性的 UUID。这样：
 *   - 同一个 chunk.id 在不同时间 upsert 仍命中同一个 point；
 *   - 不需要维护额外的 id 映射表。
 */
import { createHash } from 'crypto';
export function toQdrantUuid(s: string): string {
  const buf = createHash('sha1').update(s).digest();
  // 强制 version=5、variant=10xx
  buf[6] = (buf[6] & 0x0f) | 0x50;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const h = buf.toString('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}