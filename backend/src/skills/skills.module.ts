import { Module } from '@nestjs/common';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';
import { SkillExecutorService } from './skill-executor.service';
import { ToolInvocationsController } from './tool-invocations.controller';

@Module({
  controllers: [SkillsController, ToolInvocationsController],
  providers: [SkillsService, SkillExecutorService],
  exports: [SkillsService, SkillExecutorService],
})
export class SkillsModule {}
