import { Module, forwardRef } from '@nestjs/common';
import { LlmController, ChatController } from './llm.controller';
import { LlmService } from './llm.service';
import { ChatEngine } from './engines/chat-engine';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({
  // forwardRef 解决与 WorkflowsModule 的循环依赖（WorkflowsModule 也需要本模块的 LlmService/ChatEngine）
  imports: [forwardRef(() => WorkflowsModule)],
  controllers: [LlmController, ChatController],
  providers: [LlmService, ChatEngine],
  exports: [LlmService, ChatEngine],
})
export class LlmModule {}
