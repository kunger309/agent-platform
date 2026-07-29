import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';

/**
 * 知识库检索配置（嵌入 retrieval_config Json）
 * topK: 向量召回 topK（默认 5）
 * scoreThreshold: 相似度阈值，低于则丢弃（默认 0，无下限）
 * reranker: 是否启用重排（默认 false）
 */
export class RetrievalConfig {
  @IsOptional()
  topK?: number;

  @IsOptional()
  scoreThreshold?: number;

  @IsOptional()
  reranker?: boolean;
}

export class CreateKnowledgeBaseDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Embedding 模型名（OpenAI 兼容协议）
   * 默认 text-embedding-3-small，实际由前端选 LlmProvider + 模型拼出
   */
  @IsOptional()
  @IsString()
  embeddingModel?: string;

  /**
   * 选用的模型提供商（LlmProvider.id），用于调用 EmbeddingsService 生成向量。
   * 不传则在处理文档时按 organizationId + embeddingModel 动态解析。
   */
  @IsOptional()
  @IsString()
  embeddingProviderId?: string;

  /**
   * 切分大小（字符数），与 documents.service 的 splitter 配合
   */
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  chunkSize?: number;

  /**
   * 切分重叠（字符数）
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  chunkOverlap?: number;

  /**
   * 检索配置（落库到 retrieval_config JSON）
   */
  @IsOptional()
  @IsObject()
  retrievalConfig?: RetrievalConfig;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}