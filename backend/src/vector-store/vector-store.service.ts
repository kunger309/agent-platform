import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VectorStoreAdapter,
  VectorPoint,
  SearchHit,
  SearchOptions,
  VectorDistance,
} from './vector-store.types';
import { QdrantAdapter } from './adapters/qdrant.adapter';

/**
 * 向量库门面服务：根据 VECTOR_STORE_PROVIDER 环境变量选择适配器。
 *
 * 当前实现：仅 Qdrant；Milvus / Weaviate 等可后续扩展。
 */
@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private adapter: VectorStoreAdapter;

  constructor(
    private readonly config: ConfigService,
    private readonly qdrantAdapter: QdrantAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    const provider = (this.config.get<string>('VECTOR_STORE_PROVIDER') || 'qdrant').toLowerCase();
    switch (provider) {
      case 'qdrant':
        this.adapter = this.qdrantAdapter;
        break;
      default:
        this.logger.warn(`未知的 VECTOR_STORE_PROVIDER=${provider}，回退到 qdrant`);
        this.adapter = this.qdrantAdapter;
    }
    // 健康检查（非阻塞，失败只 warn 不抛错）
    try {
      const health = await this.adapter.health();
      if (health.ok) {
        this.logger.log(`✅ vector-store 已就绪 [${this.adapter.name}]`);
      } else {
        this.logger.warn(`⚠️  vector-store 健康检查失败: ${health.detail}`);
      }
    } catch (err: any) {
      this.logger.warn(`⚠️  vector-store 健康检查异常: ${err.message}`);
    }
  }

  get active(): VectorStoreAdapter {
    if (!this.adapter) {
      throw new Error('vector-store 适配器尚未初始化');
    }
    return this.adapter;
  }

  // ============================================================
  // 透传快捷方法（避免业务代码直接拿 active.adapter.xxx）
  // ============================================================

  ensureCollection(
    knowledgeBaseId: string,
    dim: number,
    distance?: VectorDistance,
  ) {
    return this.active.ensureCollection(knowledgeBaseId, dim, distance);
  }

  deleteCollection(knowledgeBaseId: string) {
    return this.active.deleteCollection(knowledgeBaseId);
  }

  upsert(knowledgeBaseId: string, points: VectorPoint[]) {
    return this.active.upsert(knowledgeBaseId, points);
  }

  deletePoints(knowledgeBaseId: string, ids: string[]) {
    return this.active.deletePoints(knowledgeBaseId, ids);
  }

  deleteByDocument(knowledgeBaseId: string, documentId: string) {
    return this.active.deleteByDocument(knowledgeBaseId, documentId);
  }

  search(
    knowledgeBaseId: string,
    organizationId: string,
    vector: number[],
    options?: SearchOptions,
  ): Promise<SearchHit[]> {
    return this.active.search(knowledgeBaseId, organizationId, vector, options);
  }
}