import { Module } from '@nestjs/common';
import { LlmController, ChatController } from './llm.controller';
import { LlmService } from './llm.service';
import { ChatEngine } from './engines/chat-engine';

@Module({
  controllers: [LlmController, ChatController],
  providers: [LlmService, ChatEngine],
  exports: [LlmService, ChatEngine],
})
export class LlmModule {}
