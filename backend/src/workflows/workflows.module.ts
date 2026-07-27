import { Module, forwardRef } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { LlmModule } from '../llm/llm.module';

@Module({
  // forwardRef 解决与 LlmModule 的循环依赖（LlmModule 也 import 本模块，用于 chat 控制器注入 WorkflowsService）
  imports: [forwardRef(() => LlmModule)],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
