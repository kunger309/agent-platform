import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { LlmModule } from '../llm/llm.module';
import { SkillsModule } from '../skills/skills.module';

@Module({
  imports: [LlmModule, SkillsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
