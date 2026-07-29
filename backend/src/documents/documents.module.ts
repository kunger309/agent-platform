import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { ParsersModule } from '../parsers/parsers.module';
import { SplittersModule } from '../splitters/splitters.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
// VectorStoreModule 是 @Global()，无需 import

@Module({
  imports: [ParsersModule, SplittersModule, EmbeddingsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
