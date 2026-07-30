import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SkillExecutorService } from './skill-executor.service';
import {
  CreateSkillDto,
  UpdateSkillDto,
  CreateSkillVersionDto,
  TestSkillDto,
} from './dto';
import type { ChatTool } from '../llm/engines/chat-engine';
import {
  parseOpenApiDocument,
  extractOpenApiTools,
} from './openapi-parser';

@Injectable()
export class SkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: SkillExecutorService,
  ) {}

  async list(organizationId: string) {
    return this.prisma.skill.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { agentSkills: true } },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true },
        },
      },
    });
  }

  async detail(id: string, organizationId: string) {
    const skill = await this.prisma.skill.findFirst({
      where: { id, organizationId },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: {
            id: true,
            version: true,
            schemaJson: true,
            sourceCode: true,
            openapiSchema: true,
            securityPolicy: true,
            createdAt: true,
          },
        },
        _count: { select: { agentSkills: true } },
      },
    });
    if (!skill) throw new NotFoundException('技能不存在');
    return skill;
  }

  async create(organizationId: string, creatorId: string, dto: CreateSkillDto) {
    if (dto.type === 'function' && !dto.sourceCode) {
      throw new ForbiddenException('function 类型技能必须提供 sourceCode');
    }
    if (dto.type === 'openapi' && !dto.openapiSchema) {
      throw new ForbiddenException('openapi 类型技能必须提供 openapiSchema');
    }

    return this.prisma.skill.create({
      data: {
        organizationId,
        creatorId,
        name: dto.name,
        type: dto.type,
        description: dto.description ?? null,
        status: dto.status ?? 'active',
        versions: {
          create: {
            version: 1,
            schemaJson: (dto.schemaJson as any) ?? {},
            sourceCode: dto.sourceCode,
            openapiSchema: dto.openapiSchema as any,
            securityPolicy: (dto.securityPolicy as any) ?? {},
          },
        },
      },
      include: {
        versions: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
  }

  async createVersion(id: string, organizationId: string, dto: CreateSkillVersionDto) {
    const skill = await this.prisma.skill.findFirst({ where: { id, organizationId } });
    if (!skill) throw new NotFoundException('技能不存在');

    const max = await this.prisma.skillVersion.aggregate({
      where: { skillId: id },
      _max: { version: true },
    });
    const next = (max._max.version ?? 0) + 1;

    // 取上一版作为默认值，未提供的字段沿用
    const prev = await this.prisma.skillVersion.findFirst({
      where: { skillId: id },
      orderBy: { version: 'desc' },
    });

    return this.prisma.skillVersion.create({
      data: {
        skillId: id,
        version: next,
        schemaJson: (dto.schemaJson as any) ?? (prev?.schemaJson as any) ?? {},
        sourceCode: dto.sourceCode ?? prev?.sourceCode,
        openapiSchema: (dto.openapiSchema as any) ?? (prev?.openapiSchema as any),
        securityPolicy: (dto.securityPolicy as any) ?? (prev?.securityPolicy as any) ?? {},
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateSkillDto) {
    const skill = await this.prisma.skill.findFirst({ where: { id, organizationId } });
    if (!skill) throw new NotFoundException('技能不存在');
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.skill.update({ where: { id }, data });
  }

  async remove(id: string, organizationId: string) {
    const skill = await this.prisma.skill.findFirst({ where: { id, organizationId } });
    if (!skill) throw new NotFoundException('技能不存在');
    await this.prisma.skill.delete({ where: { id } });
    return { success: true };
  }

  async test(id: string, organizationId: string, userId: string | undefined, dto: TestSkillDto) {
    const version = await this.getVersion(id, organizationId, dto.version);
    // 为测试调用建一个 Execution 占位，便于在 ToolInvocation 列表里看到（executionId 必填）
    let executionId: string | undefined;
    try {
      const exec = await this.prisma.execution.create({
        data: {
          organizationId,
          userId: userId ?? '',
          status: 'running',
          inputJson: { source: 'skill-test', skillId: id },
          traceId: `skill_test_${id}_${Date.now()}`,
        },
      });
      executionId = exec.id;
    } catch {}
    const result = await this.executor.executeByVersion(version, dto.input ?? {}, {
      executionId,
      orgId: organizationId,
      userId,
    });
    if (executionId) {
      try {
        await this.prisma.execution.update({
          where: { id: executionId },
          data: {
            status: result.status === 'success' ? 'success' : 'failed',
            outputJson: { output: result.output, durationMs: result.durationMs },
            finishedAt: new Date(),
          },
        });
      } catch {}
    }
    return { success: result.status === 'success', ...result };
  }

  /** 取指定版本（默认最新）；供 test / agent chat / workflow 复用 */
  async getVersion(skillId: string, organizationId: string, version?: number) {
    const where: any = { skillId };
    const skill = await this.prisma.skill.findFirst({ where: { id: skillId, organizationId } });
    if (!skill) throw new NotFoundException('技能不存在');

    if (version != null) where.version = version;
    const v = await this.prisma.skillVersion.findFirst({
      where,
      orderBy: { version: 'desc' },
      include: { skill: true },
    });
    if (!v) throw new NotFoundException('技能版本不存在');
    return v;
  }

  /** 取最新版本（带 skill 关联），供 agent 工具构建 / workflow 执行 */
  async getLatestVersion(skillId: string) {
    const v = await this.prisma.skillVersion.findFirst({
      where: { skillId },
      orderBy: { version: 'desc' },
      include: { skill: true },
    });
    if (!v) throw new NotFoundException('技能版本不存在');
    return v;
  }

  /**
   * 为某个技能构建 LLM 工具定义（ChatTool），供 agents 的 bindTools 使用。
   * - function 类型：参数 schema 为 { input: object }
   * - openapi 类型：参数 schema 由第一个操作的参数推导
   * - opts 透传给 SkillExecutor 用于落 ToolInvocation（executionId/agentId/userId/orgId）
   */
  async buildTool(skillId: string, opts?: { executionId?: string; agentId?: string; userId?: string; orgId?: string }): Promise<ChatTool> {
    const version = await this.getLatestVersion(skillId);
    const skill = version.skill;
    const toolName = `skill_${(skill.id || '').replace(/[^a-zA-Z0-9_]/g, '_')}`;

    if (skill.type === 'function') {
      return {
        name: toolName,
        description: skill.description || skill.name,
        schema: {
          type: 'object',
          properties: { input: { type: 'object', description: '输入参数对象' } },
          required: ['input'],
        },
        execute: async (args: any) => {
          const input = args?.input ?? {};
          const r = await this.executor.executeByVersion(version, input, opts);
          if (r.status === 'failed') throw new Error(r.error || '执行失败');
          return typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
        },
      };
    }

    // openapi 类型
    const doc = parseOpenApiDocument((version.openapiSchema as any) || {});
    const specs = extractOpenApiTools(doc);
    const spec = specs[0];
    const props: Record<string, any> = {
      operation: { type: 'string', description: '要调用的操作（默认第一个）' },
    };
    for (const p of spec?.parameters || []) {
      props[p.name] = { type: p.type || 'string', description: p.description };
    }
    return {
      name: toolName,
      description: skill.description || skill.name,
      schema: { type: 'object', properties: props },
      execute: async (args: any) => {
        const r = await this.executor.executeByVersion(version, args ?? {}, opts);
        if (r.status === 'failed') throw new Error(r.error || '执行失败');
        return typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
      },
    };
  }
}
