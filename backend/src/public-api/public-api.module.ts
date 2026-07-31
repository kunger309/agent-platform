import { Module } from '@nestjs/common';
import { PublicApiController } from './public-api.controller';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AgentsModule } from '../agents/agents.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { RetrieversModule } from '../retrievers/retrievers.module';

@Module({
  imports: [ApiKeysModule, AgentsModule, WorkflowsModule, RetrieversModule],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
