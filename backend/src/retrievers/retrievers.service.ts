import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { KnowledgeBasesService } from '../knowledge-bases/knowledge-bases.service';
import {
  RetrieveOptions,
  RetrieveResult,
  RetrievedChunk,
} from './retrievers.types';
import { SearchHit } from '../vector-store/vector-store.types';

/** BM25 参数 */
const K1 = 1.5;
const B = 0.75;
/** RRF 常数（经验值 60） */
const RRF_K = 60;
/** 单条召回放大系数：实际融合前每条通道取 topK*FANOUT 候选 */
const FANOUT = 3;

/**
 * 混合检索服务：向量召回（dense）+ BM25 关键词召回（sparse）→ RRF 融合。
 *
 * 设计取舍：
 * - 向量召回走 Qdrant（vectorStore.search），带 orgId 防御过滤；
 * - BM25 召回在 Node 侧对本 KB 的 document_chunks 做轻量 BM25 打分
 *   （中文按字 bigram、英文按词，IDF 在本 KB 语料内计算）。
 *   理由：Postgres 默认字典对中文分词无效，且避免依赖 pg_trgm 扩展；
 *   对 Phase 3 规模（单 KB 数百~数千切片）完全够用。生产可换成 pg_trgm / ES。
 * - RRF（Reciprocal Rank Fusion）对两个不同量纲的召回列表做无权重融合，
 *   比直接加相似度分数更鲁棒。
 */
@Injectable()
export class RetrieversService {
  private readonly logger = new Logger(RetrieversService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly vectorStore: VectorStoreService,
    private readonly kbs: KnowledgeBasesService,
  ) {}

  async retrieve(
    organizationId: string,
    kbId: string,
    query: string,
    opts: RetrieveOptions = {},
  ): Promise<RetrieveResult> {
    const topK = opts.topK ?? 5;

    // 1) KB 校验（不存在 / 越权都会抛错）
    const kb = await this.kbs.detail(kbId, organizationId);

    // 2) 解析 embedding provider + 模型（与 documents 流水线一致）
    const providerId = await this.resolveEmbeddingProvider(
      organizationId,
      (kb as any).embeddingProviderId,
      (kb as any).embeddingModel,
    );

    // 3) 向量召回
    const vector = await this.embeddings.embedQuery(
      providerId,
      organizationId,
      (kb as any).embeddingModel,
      query,
    );
    const vectorHits: SearchHit[] = await this.vectorStore.search(
      kbId,
      organizationId,
      vector,
      {
        topK: Math.max(topK * FANOUT, 20),
        scoreThreshold: opts.scoreThreshold,
        withOrgFilter: true,
      },
    );

    // 4) BM25 关键词召回
    const bm25Hits: SearchHit[] = await this.bm25Recall(
      organizationId,
      kbId,
      query,
      Math.max(topK * FANOUT, 20),
    );

    // 5) RRF 融合
    const results: RetrievedChunk[] = this.rrfFuse(
      [vectorHits, bm25Hits],
      topK,
    );

    return { query, topK, total: results.length, results };
  }

  // ============================================================
  // 私有：embedding provider 解析（与 documents.service 保持一致）
  // ============================================================
  private async resolveEmbeddingProvider(
    organizationId: string,
    explicitProviderId: string | null | undefined,
    model: string,
  ): Promise<string> {
    if (explicitProviderId) {
      const p = await this.prisma.llmProvider.findFirst({
        where: { id: explicitProviderId, organizationId, status: 'active' },
      });
      if (p) return p.id;
      this.logger.warn(
        `retrieve 指定的 embeddingProviderId=${explicitProviderId} 不可用，回退动态解析`,
      );
    }
    const candidates = await this.prisma.llmProvider.findMany({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    if (candidates.length === 0) {
      throw new ForbiddenException(
        '当前组织没有可用的模型提供商，无法生成查询向量。请先添加模型提供商。',
      );
    }
    const lower = (model || '').toLowerCase();
    const preferMiniMax = lower.includes('embo');
    const matched = candidates.find((c) =>
      preferMiniMax
        ? c.providerType === 'MiniMax'
        : c.providerType !== 'MiniMax',
    );
    return (matched || candidates[0]).id;
  }

  // ============================================================
  // 私有：BM25 关键词召回（Node 侧，基于本 KB 的 chunks）
  // ============================================================
  private async bm25Recall(
    organizationId: string,
    kbId: string,
    query: string,
    limit: number,
  ): Promise<SearchHit[]> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        document: {
          knowledgeBaseId: kbId,
          knowledgeBase: { organizationId },
        },
      },
      select: {
        id: true,
        content: true,
        chunkIndex: true,
        documentId: true,
      },
    });
    if (chunks.length === 0) return [];

    // 语料 token 化
    const tokenized = chunks.map((c) => ({
      id: c.id,
      content: c.content,
      chunkIndex: c.chunkIndex,
      documentId: c.documentId,
      tokens: tokenize(c.content),
    }));
    const N = tokenized.length;
    if (N === 0) return [];

    // 文档频率 df
    const df = new Map<string, number>();
    for (const d of tokenized) {
      const uniq = new Set(d.tokens);
      for (const t of uniq) df.set(t, (df.get(t) || 0) + 1);
    }
    const avgdl =
      tokenized.reduce((s, d) => s + d.tokens.length, 0) / N || 1;

    // 查询词（去重）
    const qTokens = Array.from(new Set(tokenize(query)));
    if (qTokens.length === 0) return [];

    const scored = tokenized
      .map((d) => {
        const tf = new Map<string, number>();
        for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
        let score = 0;
        for (const qt of qTokens) {
          const f = tf.get(qt) || 0;
          if (f === 0) continue;
          const curDf = df.get(qt) || 0;
          const idf = Math.log(1 + (N - curDf + 0.5) / (curDf + 0.5));
          const dl = d.tokens.length;
          score +=
            idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (dl / avgdl))));
        }
        return {
          id: d.id,
          score,
          content: d.content,
          chunkIndex: d.chunkIndex,
          documentId: d.documentId,
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((x) => ({
      id: x.id,
      score: x.score,
      payload: {
        organizationId,
        knowledgeBaseId: kbId,
        documentId: x.documentId,
        chunkIndex: x.chunkIndex,
        content: x.content,
      },
    }));
  }

  // ============================================================
  // 私有：RRF 融合（按 chunk id 合并两路召回）
  // ============================================================
  private rrfFuse(lists: SearchHit[][], topK: number): RetrievedChunk[] {
    const map = new Map<string, RetrievedChunk>();

    lists.forEach((hits, listIdx) => {
      const sourceName = listIdx === 0 ? 'vector' : 'bm25';
      hits.forEach((hit, rank) => {
        const fused = 1 / (RRF_K + rank + 1);
        const existing = map.get(hit.id);
        if (!existing) {
          const entry: RetrievedChunk = {
            id: hit.id,
            content: hit.payload?.content ?? '',
            documentId: hit.payload?.documentId,
            chunkIndex: hit.payload?.chunkIndex,
            score: fused,
            sources: [sourceName],
          };
          if (listIdx === 0) entry.vectorScore = hit.score;
          else entry.bm25Score = hit.score;
          map.set(hit.id, entry);
        } else {
          existing.score += fused;
          if (!existing.sources.includes(sourceName)) {
            existing.sources.push(sourceName);
          }
          if (listIdx === 0) {
            existing.vectorScore = hit.score;
            if (!existing.content && hit.payload?.content) {
              existing.content = hit.payload.content;
            }
          } else {
            existing.bm25Score = hit.score;
            if (!existing.content && hit.payload?.content) {
              existing.content = hit.payload.content;
            }
          }
          if (!existing.documentId && hit.payload?.documentId) {
            existing.documentId = hit.payload.documentId;
          }
          if (existing.chunkIndex === undefined && hit.payload?.chunkIndex !== undefined) {
            existing.chunkIndex = hit.payload.chunkIndex;
          }
        }
      });
    });

    return Array.from(map.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

/**
 * 轻量 tokenizer（中英混合）：
 * - 拉丁/数字词：正则 [\w]+ 提取
 * - 中文：按字 bigram（CJK 区间），单字则整体
 */
function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const latin = lower.match(/[a-z0-9]+/g);
  if (latin) tokens.push(...latin);
  const cjkRuns = lower.match(/[一-鿿]+/g);
  if (cjkRuns) {
    for (const run of cjkRuns) {
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let i = 0; i < run.length - 1; i++) {
          tokens.push(run.slice(i, i + 2));
        }
      }
    }
  }
  return tokens;
}
