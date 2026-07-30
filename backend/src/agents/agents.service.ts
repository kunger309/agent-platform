import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ChatEngine } from '../llm/engines/chat-engine';
import { SkillsService } from '../skills/skills.service';
import { CreateAgentDto, UpdateAgentDto, ChatDto } from './dto/create-agent.dto';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatEngine: ChatEngine,
    private readonly skills: SkillsService,
  ) {}

  private readonly logger = new Logger(AgentsService.name);

  async list(organizationId: string) {
    return this.prisma.agent.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        avatar: true,
        status: true,
        updatedAt: true,
        createdAt: true,
      },
    });
  }

  async detail(id: string, organizationId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id, organizationId },
      include: {
        agentSkills: {
          include: { skill: { select: { id: true, name: true, type: true, status: true } } },
        },
      },
    });
    if (!agent) throw new NotFoundException('Agent 不存在');
    return agent;
  }

  async create(organizationId: string, creatorId: string, dto: CreateAgentDto) {
    // 校验 providerId 属于同一组织
    const provider = await this.prisma.llmProvider.findFirst({
      where: { id: dto.modelConfig.providerId, organizationId },
    });
    if (!provider) throw new NotFoundException('指定的模型提供商不存在或无权访问');

    return this.prisma.agent.create({
      data: {
        organizationId,
        creatorId,
        name: dto.name,
        type: dto.type,
        description: dto.description,
        systemPrompt: dto.systemPrompt ?? '',
        modelConfig: dto.modelConfig as any,
        status: 'draft',
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateAgentDto) {
    const existing = await this.detail(id, organizationId);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.systemPrompt !== undefined) data.systemPrompt = dto.systemPrompt;
    if (dto.modelConfig !== undefined) data.modelConfig = dto.modelConfig;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.agent.update({ where: { id }, data });
  }

  async delete(id: string, organizationId: string) {
    await this.detail(id, organizationId);
    await this.prisma.agent.delete({ where: { id } });
    return { success: true };
  }

  /** 获取智能体已绑定的技能列表 */
  async getSkills(agentId: string, organizationId: string) {
    await this.detail(agentId, organizationId);
    return this.prisma.agentSkill.findMany({
      where: { agentId },
      include: {
        skill: { select: { id: true, name: true, type: true, status: true, description: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 替换智能体的技能绑定（全量替换语义）
   * @param skills 形如 [{ skillId, enabled?, configJson? }]
   */
  async setSkills(
    agentId: string,
    organizationId: string,
    skills: Array<{ skillId: string; enabled?: boolean; configJson?: any }>,
  ) {
    await this.detail(agentId, organizationId);
    // 校验所有 skillId 属于本组织，防止越权绑定
    if (skills?.length) {
      const ids = skills.map((s) => s.skillId);
      const owned = await this.prisma.skill.count({
        where: { id: { in: ids }, organizationId },
      });
      if (owned !== ids.length) throw new ForbiddenException('包含越权的技能绑定');
    }

    await this.prisma.agentSkill.deleteMany({ where: { agentId } });
    if (skills?.length) {
      await this.prisma.agentSkill.createMany({
        data: skills.map((s) => ({
          agentId,
          skillId: s.skillId,
          enabled: s.enabled ?? true,
          configJson: (s.configJson as any) ?? {},
        })),
      });
    }
    return { success: true, count: skills?.length ?? 0 };
  }

  /**
   * 聊天入口：创建 chatModel，加载历史，调用 ChatEngine 流式输出
   */
  async chat(
    agentId: string,
    currentUser: any,
    dto: ChatDto,
  ) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, organizationId: currentUser.currentOrgId },
    });
    if (!agent) throw new NotFoundException('Agent 不存在');

    const config = (agent.modelConfig as any) || {};
    if (!config.providerId) throw new ForbiddenException('Agent 未配置模型提供商');

    const provider = await this.llm.getDecrypted(config.providerId);
    const chatModel = this.llm.createChatModel(
      {
        providerType: provider.providerType as string,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        defaultModel: provider.defaultModel,
        models: provider.models,
      },
      config.model,
    );

    // 1) 加载或创建 conversation
    let conversationId = dto.conversationId;
    if (!conversationId) {
      const conv = await this.prisma.conversation.create({
        data: {
          agentId,
          userId: currentUser.userId,
          organizationId: currentUser.currentOrgId,
          title: dto.message.slice(0, 30),
          lastMessageAt: new Date(),
        },
      });
      conversationId = conv.id;
    } else {
      // 复用会话时必须归属同一 agent，防止把 A 智能体的历史喂给 B
      const exists = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId: currentUser.userId, agentId },
      });
      if (!exists) throw new ForbiddenException('无权访问该会话');
    }

    // 2) 先保存用户消息（必须在加载历史之前）
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: dto.message,
      },
    });

    // 3) 加载历史（此时 user 消息已在库中）
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    // 4) 构建工具：加载启用的技能，转为 ChatTool
    //    为了让 ToolInvocation 能按智能体/用户/组织筛选，这里为本次对话建一个 Execution 记录，
    //    并把 executionId/agentId/userId/orgId 透传给 buildTool → executeByVersion。
    let tools: any[] = [];
    let chatExecutionId: string | undefined;
    try {
      const exec = await this.prisma.execution.create({
        data: {
          organizationId: currentUser.currentOrgId,
          agentId,
          conversationId,
          userId: currentUser.userId,
          status: 'running',
          inputJson: { message: dto.message.slice(0, 500) },
          traceId: `chat_${conversationId}_${Date.now()}`,
        },
      });
      chatExecutionId = exec.id;
    } catch (e: any) {
      // 建 Execution 失败不影响聊天本身，只是这次调用不落 ToolInvocation
      this.logger.warn(`[AgentsService] 建 chat Execution 失败: ${e?.message}`);
    }
    const execOpts = chatExecutionId
      ? { executionId: chatExecutionId, agentId, userId: currentUser.userId, orgId: currentUser.currentOrgId }
      : undefined;
    try {
      const agentSkills = await this.prisma.agentSkill.findMany({
        where: { agentId, enabled: true },
      });
      for (const as of agentSkills) {
        try {
          tools.push(await this.skills.buildTool(as.skillId, execOpts));
        } catch (e: any) {
          this.logger.warn(`[AgentsService] 构建技能工具失败 ${as.skillId}: ${e?.message}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`[AgentsService] 加载技能失败: ${e?.message}`);
    }

    // 5) 流式生成，组装完整回复入库
    const { stream, getAccumulated, getToolCalls } = await this.chatEngine.streamChat({
      llm: chatModel,
      history: msgs as any,
      systemPrompt: agent.systemPrompt || undefined,
      tools,
    });

    // 6) 异步保存 assistant 消息（流结束后）
    //    注意：用户可能在流式期间并发删除 conversation → P2025，必须吞掉避免进程崩溃
    stream.on('end', () => {
      void (async () => {
        try {
          const fullText = getAccumulated();
          const calls = getToolCalls();
          if (fullText) {
            await this.prisma.message.create({
              data: {
                conversationId,
                role: 'assistant',
                content: fullText,
                toolCalls: calls.length ? (calls as any) : undefined,
              },
            });
          }
          await this.prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date() },
          });
          // 关闭 chat Execution：标记成功，附带最终回复与工具调用次数
          if (chatExecutionId) {
            try {
              await this.prisma.execution.update({
                where: { id: chatExecutionId },
                data: {
                  status: 'success',
                  outputJson: { toolCallCount: calls?.length || 0, hasText: !!fullText },
                  finishedAt: new Date(),
                },
              });
            } catch (e: any) {
              if (e?.code !== 'P2025') this.logger.warn(`[AgentsService] close Execution 失败: ${e?.message}`);
            }
          }
        } catch (err: any) {
          if (err?.code !== 'P2025') {
            console.error('[AgentsService] persist assistant message failed:', err?.message);
          }
        }
      })();
    });

    return { stream, conversationId };
  }
}