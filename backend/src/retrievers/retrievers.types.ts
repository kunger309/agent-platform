/**
 * 检索模块类型定义。
 *
 * 混合检索（hybrid retrieval）返回结构：
 * - results 内每条是「融合后」的 chunk，附带它来自向量召回 / BM25 召回 / 两者皆有。
 */

export interface RetrieveOptions {
  /** 返回条数（默认 5） */
  topK?: number;
  /** 向量相似度下限（0~1），低于此的向量召回会被剔除 */
  scoreThreshold?: number;
  /** 额外过滤（预留，如按 documentId 过滤） */
  filter?: Record<string, any>;
}

export interface RetrievedChunk {
  /** DocumentChunk.id（也是向量库 point id） */
  id: string;
  content: string;
  documentId?: string;
  chunkIndex?: number;
  /** RRF 融合后的综合得分（越大越相关） */
  score: number;
  /** 原始向量召回得分（cosine，命中才有） */
  vectorScore?: number;
  /** 原始 BM25 得分（命中才有） */
  bm25Score?: number;
  /** 来源：'vector' / 'bm25' / 两者 */
  sources: string[];
}

export interface RetrieveResult {
  query: string;
  topK: number;
  total: number;
  results: RetrievedChunk[];
}
