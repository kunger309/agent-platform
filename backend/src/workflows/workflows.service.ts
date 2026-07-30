import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ChatEngine } from '../llm/engines/chat-engine';
import { RetrieversService } from '../retrievers/retrievers.service';
import { SkillExecutorService } from '../skills/skill-executor.service';
import { SkillsService } from '../skills/skills.service';
import { runWorkflowSafe } from './graph/compiler';
import { CreateWorkflowDto, UpdateWorkflowDto, RunWorkflowDto } from './dto';

const EMPTY_GRAPH = { nodes: [], edges: [] };

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    // forwardRef：WorkflowsModule ↔ LlmModule 循环依赖
    @Inject(forwardRef(() => LlmService))
    private readonly llm: LlmService,
    @Inject(forwardRef(() => ChatEngine))
    private readonly chatEngine: ChatEngine,
    private readonly retrievers: RetrieversService,
    private readonly skills: SkillExecutorService,
    // SkillsService 提供 getLatestVersion（handleSkill 需要）；SkillExecutorService 提供 executeByVersion
    private readonly skillsCatalog: SkillsService,
  ) {}

  private readonly logger = new Logger(WorkflowsService.name);

  async list(organizationId: string) {
    return this.prisma.workflow.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        creatorId: true,
      },
    });
  }

  async detail(id: string, organizationId: string) {
    const wf = await this.prisma.workflow.findFirst({ where: { id, organizationId } });
    if (!wf) throw new NotFoundException('工作流不存在');
    return wf;
  }

  async create(organizationId: string, creatorId: string, dto: CreateWorkflowDto) {
    return this.prisma.workflow.create({
      data: {
        organizationId,
        creatorId,
        name: dto.name,
        description: dto.description,
        graphJson: (dto.graphJson as any) || EMPTY_GRAPH,
        status: 'draft',
        version: 1,
      },
    });
  }

  async update(id: string, organizationId: string, dto: UpdateWorkflowDto) {
    await this.detail(id, organizationId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.graphJson !== undefined) data.graphJson = dto.graphJson;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.workflow.update({ where: { id }, data });
  }

  /** 发布：状态置 published 并把版本号 +1（轻量版本管理） */
  async publish(id: string, organizationId: string) {
    const wf = await this.detail(id, organizationId);
    return this.prisma.workflow.update({
      where: { id },
      data: { status: 'published', version: wf.version + 1 },
    });
  }

  async remove(id: string, organizationId: string) {
    await this.detail(id, organizationId);
    await this.prisma.workflow.delete({ where: { id } });
    return { success: true };
  }

  async listExecutions(workflowId: string, organizationId: string) {
    return this.prisma.execution.findMany({
      where: { workflowId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        inputJson: true,
        outputJson: true,
        errorMessage: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });
  }

  async getExecution(executionId: string, organizationId: string) {
    const ex = await this.prisma.execution.findFirst({
      where: { id: executionId, organizationId },
      include: { logs: { orderBy: { createdAt: 'asc' } } },
    });
    if (!ex) throw new NotFoundException('执行记录不存在');
    return ex;
  }

  /**
   * 运行工作流（流式）。
   * @param emit 由 controller 提供（写入 SSE）；本方法在其之上叠加 ExecutionLog 落库 + Execution 状态更新。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(id: string, organizationId: string, userId: string, dto: RunWorkflowDto, emit: (e: any) => void, conversationId?: string) {
    const wf = await this.detail(id, organizationId);
    const input = (dto.input || '').toString();

    const execution = await this.prisma.execution.create({
      data: {
        organizationId,
        workflowId: id,
        userId,
        conversationId: conversationId || null,
        status: 'running',
        inputJson: { input },
        traceId: randomUUID(),
        startedAt: new Date(),
      },
    });

    // 包装 emit：落 ExecutionLog（节点级）+ 转发 SSE；最终 Execution 状态由下方 await 后统一更新，
    // 避免 fire-and-forget 导致客户端立即刷新时仍看到 running。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const emitAndLog = async (ev: any) => {
      emit(ev);
      try {
        if (ev.type === 'node_start') {
          await this.prisma.executionLog.create({
            data: {
              executionId: execution.id,
              nodeKey: ev.nodeId,
              eventType: 'node_start',
              payloadJson: { nodeType: ev.nodeType, label: ev.label, input: ev.input },
            },
          });
        } else if (ev.type === 'node_end') {
          await this.prisma.executionLog.create({
            data: {
              executionId: execution.id,
              nodeKey: ev.nodeId,
              eventType: 'node_end',
              payloadJson: { output: ev.output },
              durationMs: ev.durationMs,
            },
          });
        }
      } catch (e: any) {
        this.logger.warn(`[WorkflowsService] persist execution log failed: ${e?.message}`);
      }
    };

    // 运行（内部异常也会被 runWorkflowSafe 捕获并发 error 事件，不会让请求挂死）
    const result = await runWorkflowSafe(
      wf.graphJson as any,
      {
        orgId: organizationId,
        llm: this.llm,
        chatEngine: this.chatEngine,
        retrievers: this.retrievers,
        // 合并两个技能服务：getLatestVersion 来自 SkillsService，executeByVersion 来自 SkillExecutorService
        skills: {
          getLatestVersion: (id: string) => this.skillsCatalog.getLatestVersion(id),
          executeByVersion: (v: any, input: any, opts?: any) =>
            this.skills.executeByVersion(v, input, opts),
        },
        emit: emitAndLog,
        runId: execution.id,
      },
      input,
    );

    // 统一落最终状态（await 完成后再返回，保证客户端查询到终态）
    await this.prisma.execution
      .update({
        where: { id: execution.id },
        data: result.error
          ? { status: 'failed', errorMessage: result.error, finishedAt: new Date() }
          : { status: 'success', outputJson: { output: result.output, variables: result.variables }, finishedAt: new Date() },
      })
      .catch((e) => this.logger.warn(`[WorkflowsService] finalize execution failed: ${e?.message}`));

    return execution.id;
  }
}
