import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Readable } from 'stream';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ChatEngine } from '../llm/engines/chat-engine';
import { SkillsService } from '../skills/skills.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { CreateAgentDto, UpdateAgentDto, ChatDto } from './dto/create-agent.dto';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly chatEngine: ChatEngine,
    private readonly skills: SkillsService,
    @Inject(forwardRef(() => WorkflowsService))
    private readonly workflows: WorkflowsService,
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
        workflowId: true,
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
        workflow: {
          select: { id: true, name: true, status: true, version: true },
        },
      },
    });
    if (!agent) throw new NotFoundException('Agent 不存在');
    return agent;
  }

  async create(organizationId: string, creatorId: string, dto: CreateAgentDto) {
    // 按 type 分支校验
    if (dto.type === 'chat') {
      const cfg = dto.modelConfig as any;
      if (!cfg || !cfg.providerId || !cfg.model) {
        throw new ForbiddenException('type=chat 时必须指定 modelConfig.providerId 与 modelConfig.model');
      }
      const provider = await this.prisma.llmProvider.findFirst({
        where: { id: cfg.providerId, organizationId },
      });
      if (!provider) throw new NotFoundException('指定的模型提供商不存在或无权访问');
    } else if (dto.type === 'workflow') {
      const wf = await this.prisma.workflow.findFirst({
        where: { id: dto.workflowId, organizationId },
        select: { id: true, status: true },
      });
      if (!wf) throw new NotFoundException('绑定的工作流不存在或无权访问');
      if (wf.status !== 'published') {
        throw new BadRequestException('只能绑定已发布（status=published）的工作流，请先在「工作流」页发布');
      }
    }

    return this.prisma.agent.create({
      data: {
        organizationId,
        creatorId,
        name: dto.name,
        type: dto.type,
        description: dto.description,
        systemPrompt: dto.systemPrompt ?? '',
        modelConfig: (dto.modelConfig as any) ?? {},
        workflowId: dto.workflowId ?? null,
        status: 'draft',
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateAgentDto) {
    const existing = await this.detail(id, organizationId);

    // 类型/字段联合校验：不允许把 chat 智能体的 modelConfig 清空，也不允许把 workflow 智能体的 workflowId 清空
    const nextType = dto.type ?? existing.type;
    if (nextType === 'chat' && dto.modelConfig !== undefined) {
      const cfg = dto.modelConfig as any;
      if (!cfg?.providerId || !cfg?.model) {
        throw new ForbiddenException('modelConfig.providerId 与 modelConfig.model 必填');
      }
    }
    if (nextType === 'workflow' && dto.workflowId !== undefined && !dto.workflowId) {
      throw new ForbiddenException('workflowId 不能为空');
    }

    // 跨组织校验：新提供的 modelConfig.providerId / workflowId 必须同组织
    if (dto.workflowId && dto.workflowId !== existing.workflowId) {
      const wf = await this.prisma.workflow.findFirst({
        where: { id: dto.workflowId, organizationId },
        select: { id: true, status: true },
      });
      if (!wf) throw new NotFoundException('绑定的工作流不存在或无权访问');
      if (wf.status !== 'published') {
        throw new BadRequestException('只能绑定已发布（status=published）的工作流，请先在「工作流」页发布');
      }
    }
    if (dto.modelConfig && nextType === 'chat') {
      const cfg = dto.modelConfig as any;
      if (cfg.providerId) {
        const provider = await this.prisma.llmProvider.findFirst({
          where: { id: cfg.providerId, organizationId },
        });
        if (!provider) throw new NotFoundException('指定的模型提供商不存在或无权访问');
      }
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.systemPrompt !== undefined) data.systemPrompt = dto.systemPrompt;
    if (dto.modelConfig !== undefined) data.modelConfig = dto.modelConfig;
    if (dto.workflowId !== undefined) data.workflowId = dto.workflowId;
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
   * 准备会话并保存用户消息（chat 与 workflow 共用前置逻辑）
   * 返回 conversationId
   */
  private async prepareConversation(
    agentId: string,
    currentUser: any,
    dto: ChatDto,
  ): Promise<string> {
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

    // 先保存用户消息（必须在加载历史之前）
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        content: dto.message,
      },
    });
    return conversationId;
  }

  /**
   * 聊天入口：按 agent.type 分支 — chat 调 LLM，workflow 跑工作流
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

    if (agent.type === 'workflow') {
      return this.chatAsWorkflow(agent, currentUser, dto);
    }
    return this.chatAsChat(agent, currentUser, dto);
  }

  /**
   * 聊天类型智能体：加载 LLM 历史，调用 ChatEngine 流式输出
   */
  private async chatAsChat(agent: any, currentUser: any, dto: ChatDto) {
    const config = (agent.modelConfig as any) || {};
    if (!config.providerId) throw new ForbiddenException('Agent 未配置模型提供商');

    const conversationId = await this.prepareConversation(agent.id, currentUser, dto);

    // 加载历史（user 消息此时已在库中）
    const msgs = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

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

    // 建 Execution 用于 ToolInvocation 关联
    let chatExecutionId: string | undefined;
    try {
      const exec = await this.prisma.execution.create({
        data: {
          organizationId: currentUser.currentOrgId,
          agentId: agent.id,
          conversationId,
          userId: currentUser.userId,
          status: 'running',
          inputJson: { message: dto.message.slice(0, 500) },
          traceId: `chat_${conversationId}_${Date.now()}`,
        },
      });
      chatExecutionId = exec.id;
    } catch (e: any) {
      this.logger.warn(`[AgentsService] 建 chat Execution 失败: ${e?.message}`);
    }

    // 构建工具：加载启用的技能
    let tools: any[] = [];
    const execOpts = chatExecutionId
      ? { executionId: chatExecutionId, agentId: agent.id, userId: currentUser.userId, orgId: currentUser.currentOrgId }
      : undefined;
    try {
      const agentSkills = await this.prisma.agentSkill.findMany({
        where: { agentId: agent.id, enabled: true },
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

    // 流式生成
    const { stream, getAccumulated, getToolCalls } = await this.chatEngine.streamChat({
      llm: chatModel,
      history: msgs as any,
      systemPrompt: agent.systemPrompt || undefined,
      tools,
    });

    // 异步保存 assistant 消息（流结束后）
    stream.on('end', () => {
      void this.persistChatAssistant(agent.id, conversationId, chatExecutionId, getAccumulated, getToolCalls);
    });

    return { stream, conversationId };
  }

  /**
   * 异步落库：assistant 消息 + 更新会话时间 + 关闭 Execution
   */
  private async persistChatAssistant(
    agentId: string,
    conversationId: string,
    chatExecutionId: string | undefined,
    getAccumulated: () => string,
    getToolCalls: () => any[],
  ) {
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
        this.logger.error(`[AgentsService] persist assistant message failed: ${err?.message}`);
      }
    }
  }

  /**
   * 流程编排类型智能体：跑工作流，把 node_token 收敛成 delta 流，done 落库
   */
  private async chatAsWorkflow(agent: any, currentUser: any, dto: ChatDto) {
    if (!agent.workflowId) throw new ForbiddenException('该流程编排智能体未绑定工作流');

    const wf = await this.prisma.workflow.findFirst({
      where: { id: agent.workflowId, organizationId: currentUser.currentOrgId },
      select: { id: true, name: true, status: true },
    });
    if (!wf) throw new NotFoundException('绑定的工作流不存在');
    // 防并发：智能体检出时工作流是 published，运行前若被改回 draft 也要拒绝
    if (wf.status !== 'published') {
      throw new ForbiddenException('绑定的工作流已下架（status≠published），无法继续运行');
    }

    const conversationId = await this.prepareConversation(agent.id, currentUser, dto);

    const stream = new Readable({ read() {} });
    let accText = '';
    let finished = false;
    let runId: string | undefined;

    // 立刻启动工作流（异步，不阻塞 SSE 第一个事件）
    void (async () => {
      try {
        const emit = (ev: any) => {
          if (ev.type === 'run_start') {
            runId = ev.runId;
          } else if (ev.type === 'node_token') {
            const delta = ev.delta ?? '';
            // 后端做 includes 去重,避免 workflow 中 LLM 节点 + Answer 节点
            // emit 同一段内容导致落库 accText 重复;同时给前端传 dedup=true
            // 标记,前端做相同去重,保证两端一致。chat 智能体走 chatAsChat,
            // delta 不带 dedup,完全不受影响。
            if (delta && !accText.includes(delta)) {
              accText += delta;
              stream.push(`data: ${JSON.stringify({ delta, dedup: true })}\n\n`);
            }
          } else if (ev.type === 'node_end') {
            // 节点结束：可用于落日志；对话流本身不直接展示
          } else if (ev.type === 'done') {
            // 兜底：若 node_token 都未触发（极端工作流），把 done.output 一次性回给前端
            if (!accText && ev.output) {
              accText = ev.output;
              stream.push(`data: ${JSON.stringify({ delta: ev.output })}\n\n`);
            }
            stream.push(`data: ${JSON.stringify({ done: true })}\n\n`);
            finished = true;
            stream.push(null);
          } else if (ev.type === 'error') {
            stream.push(`data: ${JSON.stringify({ error: ev.message || '工作流执行失败' })}\n\n`);
            finished = true;
            stream.push(null);
          }
        };

        await this.workflows.run(
          agent.workflowId,
          currentUser.currentOrgId,
          currentUser.userId,
          { input: dto.message },
          emit,
          conversationId,
        );

        // 兜底：工作流未发 done（比如用户提前断连导致 emit 没跑完）
        if (!finished) {
          stream.push(`data: ${JSON.stringify({ done: true })}\n\n`);
          stream.push(null);
        }

        // 异步落库（吞 P2025 防止用户并发删除会话）
        try {
          if (accText) {
            await this.prisma.message.create({
              data: { conversationId, role: 'assistant', content: accText },
            });
          }
          await this.prisma.conversation.update({
            where: { id: conversationId },
            data: { lastMessageAt: new Date() },
          });
        } catch (e: any) {
          if (e?.code !== 'P2025') {
            this.logger.error(`[AgentsService] persist workflow-assistant 失败: ${e?.message}`);
          }
        }
      } catch (e: any) {
        this.logger.error(`[AgentsService] workflow agent run failed: ${e?.message}`);
        try {
          stream.push(`data: ${JSON.stringify({ error: e?.message || String(e) })}\n\n`);
          stream.push(null);
        } catch {
          /* stream may already be closed */
        }
      }
    })();

    return { stream, conversationId };
  }
}
