import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PrismaService } from '../database/prisma.service';

/**
 * 技能调用记录查询：分页 + 多维筛选。
 * 用于前端"调用记录"页面，展示 Agent 对话 / 工作流 / 测试调用产生的所有 ToolInvocation。
 */
@Controller('tool-invocations')
@UseGuards(JwtAuthGuard)
export class ToolInvocationsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/tool-invocations
   * Query: agentId?, skillId?, userId?, status?, executionId?, from?, to?, page?, pageSize?
   */
  @Get()
  @RequirePermission('execution:list')
  async list(
    @Req() req: any,
    @Query('agentId') agentId?: string,
    @Query('skillId') skillId?: string,
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('executionId') executionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const orgId: string | undefined = req.user?.currentOrgId;
    const where: any = { organizationId: orgId };
    if (agentId) where.agentId = agentId;
    if (skillId) where.skillId = skillId;
    if (userId) where.userId = userId;
    if (status) where.status = status;
    if (executionId) where.executionId = executionId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const take = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 200);
    const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * take;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.toolInvocation.count({ where }),
      this.prisma.toolInvocation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);

    // 关联技能/智能体/用户名称（仅取本次返回涉及的 id，限制 100 以内）
    const skillIds = Array.from(new Set(rows.map((r) => r.skillId).filter(Boolean)));
    const agentIds = Array.from(new Set(rows.map((r) => r.agentId).filter(Boolean) as string[]));
    const userIds = Array.from(new Set(rows.map((r) => r.userId).filter(Boolean) as string[]));

    const [skills, agents, users] = await Promise.all([
      skillIds.length
        ? this.prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, name: true, type: true } })
        : Promise.resolve([]),
      agentIds.length
        ? this.prisma.agent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, name: true } })
        : Promise.resolve([]),
    ]);

    const skillMap = Object.fromEntries(skills.map((s) => [s.id, s]));
    const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));
    const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

    const items = rows.map((r) => ({
      ...r,
      skill: r.skillId ? skillMap[r.skillId] || null : null,
      agent: r.agentId ? agentMap[r.agentId] || null : null,
      user: r.userId ? userMap[r.userId] || null : null,
    }));

    return { success: true, data: { items, total, page: parseInt(page, 10) || 1, pageSize: take } };
  }

  /** GET /api/tool-invocations/stats — 概览：今日 / 本周调用次数、按技能聚合 */
  @Get('stats')
  @RequirePermission('execution:list')
  async stats(@Req() req: any) {
    const orgId: string | undefined = req.user?.currentOrgId;
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [total7d, bySkill, byStatus] = await Promise.all([
      this.prisma.toolInvocation.count({ where: { organizationId: orgId, createdAt: { gte: since } } }),
      this.prisma.toolInvocation.groupBy({
        by: ['skillId'],
        where: { organizationId: orgId, createdAt: { gte: since } },
        _count: { _all: true },
        _avg: { durationMs: true },
        orderBy: { _count: { skillId: 'desc' } },
        take: 10,
      }),
      this.prisma.toolInvocation.groupBy({
        by: ['status'],
        where: { organizationId: orgId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);
    const skillIds = bySkill.map((g) => g.skillId);
    const skills = skillIds.length
      ? await this.prisma.skill.findMany({ where: { id: { in: skillIds } }, select: { id: true, name: true } })
      : [];
    const skillMap = Object.fromEntries(skills.map((s) => [s.id, s.name]));
    return {
      success: true,
      data: {
        totalLast7Days: total7d,
        topSkills: bySkill.map((g) => ({
          skillId: g.skillId,
          skillName: skillMap[g.skillId] || '(已删除)',
          count: g._count._all,
          avgDurationMs: Math.round(g._avg.durationMs || 0),
        })),
        byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      },
    };
  }
}
