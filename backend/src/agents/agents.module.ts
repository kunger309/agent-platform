import { Module, forwardRef } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { LlmModule } from '../llm/llm.module';
import { SkillsModule } from '../skills/skills.module';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({
  imports: [
    LlmModule,
    SkillsModule,
    // forwardRef 防止未来工作流反向引用 AgentService 时形成循环
    forwardRef(() => WorkflowsModule),
  ],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
