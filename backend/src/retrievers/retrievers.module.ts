import { Module } from '@nestjs/common';
import { RetrieversController } from './retrievers.controller';
import { RetrieversService } from './retrievers.service';
import { KnowledgeBasesModule } from '../knowledge-bases/knowledge-bases.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
// VectorStoreModule 是 @Global()，无需 import
// DatabaseModule 是 @Global()（PrismaService），无需 import

@Module({
  imports: [KnowledgeBasesModule, EmbeddingsModule],
  controllers: [RetrieversController],
  providers: [RetrieversService],
  exports: [RetrieversService],
})
export class RetrieversModule {}
