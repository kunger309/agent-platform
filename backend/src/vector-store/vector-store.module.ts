import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VectorStoreService } from './vector-store.service';
import { QdrantAdapter } from './adapters/qdrant.adapter';

/**
 * 全局模块：业务模块（documents / retrievers / chat-engine）都能直接注入 VectorStoreService。
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [QdrantAdapter, VectorStoreService],
  exports: [VectorStoreService],
})
export class VectorStoreModule {}