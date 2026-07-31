import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * 工作台统计：按当前 org 维度返回各实体计数。
 * 不走缓存：dashboard 访问频率低，简单 count 足够。
 * 不统计 Execution（无 organizationId，需 join Workflow，过重）。
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async stats(organizationId: string) {
    const [agents, workflows, knowledgeBases, skills, conversations, org] = await Promise.all([
      this.prisma.agent.count({ where: { organizationId } }),
      this.prisma.workflow.count({ where: { organizationId } }),
      this.prisma.knowledgeBase.count({ where: { organizationId } }),
      this.prisma.skill.count({ where: { organizationId } }),
      this.prisma.conversation.count({ where: { organizationId } }),
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true },
      }),
    ]);

    return {
      orgId: org?.id || organizationId,
      orgName: org?.name || '',
      agents,
      workflows,
      knowledgeBases,
      skills,
      conversations,
    };
  }
}