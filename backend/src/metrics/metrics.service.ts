import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { PrismaService } from '../database/prisma.service';

/**
 * 统一指标中心。
 *
 * 约定：
 * - 所有指标以 `agentx_` 前缀，避免与进程默认指标混淆
 * - label 基数必须可控（不要把 conversationId / 用户输入塞进 label）
 * - 采集失败一律吞掉，监控不允许影响主链路
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  readonly registry = new Registry();

  // ---- HTTP ----
  private httpTotal: Counter<string>;
  private httpDuration: Histogram<string>;
  private httpInFlight: Gauge<string>;

  // ---- 业务 ----
  private llmTotal: Counter<string>;
  private llmDuration: Histogram<string>;
  private workflowTotal: Counter<string>;
  private workflowDuration: Histogram<string>;
  private skillTotal: Counter<string>;
  private skillDuration: Histogram<string>;
  private embeddingTotal: Counter<string>;
  private apiKeyTotal: Counter<string>;
  private apiKeyDuration: Histogram<string>;

  // ---- 业务存量（抓取时按需刷新，带缓存）----
  private entityGauge: Gauge<string>;
  private lastEntityRefresh = 0;
  private static readonly ENTITY_TTL_MS = 15_000;

  constructor(private readonly prisma: PrismaService) {
    this.registry.setDefaultLabels({ app: 'agent-platform' });
    collectDefaultMetrics({ register: this.registry, prefix: 'agentx_node_' });

    this.httpTotal = new Counter({
      name: 'agentx_http_requests_total',
      help: 'HTTP 请求总数',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'agentx_http_request_duration_seconds',
      help: 'HTTP 请求耗时（秒）',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 3, 5, 10, 30],
      registers: [this.registry],
    });
    this.httpInFlight = new Gauge({
      name: 'agentx_http_in_flight_requests',
      help: '正在处理的 HTTP 请求数',
      registers: [this.registry],
    });

    this.llmTotal = new Counter({
      name: 'agentx_llm_requests_total',
      help: 'LLM 调用次数',
      labelNames: ['provider', 'model', 'status'],
      registers: [this.registry],
    });
    this.llmDuration = new Histogram({
      name: 'agentx_llm_request_duration_seconds',
      help: 'LLM 调用耗时（秒）',
      labelNames: ['provider', 'model'],
      buckets: [0.2, 0.5, 1, 2, 5, 10, 20, 60],
      registers: [this.registry],
    });

    this.workflowTotal = new Counter({
      name: 'agentx_workflow_runs_total',
      help: '工作流执行次数',
      labelNames: ['workflow_id', 'status'],
      registers: [this.registry],
    });
    this.workflowDuration = new Histogram({
      name: 'agentx_workflow_run_duration_seconds',
      help: '工作流执行耗时（秒）',
      labelNames: ['workflow_id'],
      buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
      registers: [this.registry],
    });

    this.skillTotal = new Counter({
      name: 'agentx_skill_invocations_total',
      help: '技能调用次数',
      labelNames: ['skill_id', 'status'],
      registers: [this.registry],
    });
    this.skillDuration = new Histogram({
      name: 'agentx_skill_invocation_duration_seconds',
      help: '技能调用耗时（秒）',
      labelNames: ['skill_id'],
      buckets: [0.05, 0.1, 0.3, 1, 3, 10, 30],
      registers: [this.registry],
    });

    this.embeddingTotal = new Counter({
      name: 'agentx_embedding_requests_total',
      help: 'Embedding 请求次数（按缓存命中区分）',
      labelNames: ['cache', 'status'],
      registers: [this.registry],
    });

    this.apiKeyTotal = new Counter({
      name: 'agentx_api_key_calls_total',
      help: '对外 API 调用次数',
      labelNames: ['key_id', 'endpoint', 'status'],
      registers: [this.registry],
    });
    this.apiKeyDuration = new Histogram({
      name: 'agentx_api_key_call_duration_seconds',
      help: '对外 API 调用耗时（秒）',
      labelNames: ['endpoint'],
      buckets: [0.1, 0.5, 1, 3, 10, 30, 60],
      registers: [this.registry],
    });

    this.entityGauge = new Gauge({
      name: 'agentx_entity_total',
      help: '平台实体存量（组织/用户/智能体/工作流/知识库/技能）',
      labelNames: ['entity'],
      registers: [this.registry],
    });
  }

  onModuleInit() {
    this.logger.log('[Metrics] registry initialized');
  }

  // ==================== 采集入口 ====================

  incHttpInFlight(delta: number) {
    this.httpInFlight.inc(delta);
  }

  observeHttp(method: string, route: string, status: number, ms: number) {
    try {
      this.httpTotal.inc({ method, route, status: String(status) });
      this.httpDuration.observe({ method, route }, ms / 1000);
    } catch {
      /* 指标异常不影响请求 */
    }
  }

  observeLlm(provider: string, model: string, status: 'success' | 'error', ms: number) {
    try {
      this.llmTotal.inc({ provider: provider || 'unknown', model: model || 'unknown', status });
      this.llmDuration.observe({ provider: provider || 'unknown', model: model || 'unknown' }, ms / 1000);
    } catch {
      /* ignore */
    }
  }

  observeWorkflowRun(workflowId: string, status: 'success' | 'error', ms: number) {
    try {
      this.workflowTotal.inc({ workflow_id: workflowId, status });
      this.workflowDuration.observe({ workflow_id: workflowId }, ms / 1000);
    } catch {
      /* ignore */
    }
  }

  observeSkillInvocation(skillId: string, status: 'success' | 'error', ms: number) {
    try {
      this.skillTotal.inc({ skill_id: skillId, status });
      this.skillDuration.observe({ skill_id: skillId }, ms / 1000);
    } catch {
      /* ignore */
    }
  }

  observeEmbedding(cache: 'hit' | 'miss', status: 'success' | 'error' = 'success') {
    try {
      this.embeddingTotal.inc({ cache, status });
    } catch {
      /* ignore */
    }
  }

  observeApiKeyCall(
    keyId: string,
    endpoint: string,
    status: 'success' | 'error',
    ms: number,
  ) {
    try {
      this.apiKeyTotal.inc({ key_id: keyId, endpoint, status });
      this.apiKeyDuration.observe({ endpoint }, ms / 1000);
    } catch {
      /* ignore */
    }
  }

  // ==================== 导出 ====================

  async scrape(): Promise<string> {
    await this.refreshEntityGauges();
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** 抓取时刷新存量 Gauge，15s 内复用上次结果，避免 Prometheus 高频抓库 */
  private async refreshEntityGauges() {
    const now = Date.now();
    if (now - this.lastEntityRefresh < MetricsService.ENTITY_TTL_MS) return;
    this.lastEntityRefresh = now;

    try {
      const [orgs, users, agents, workflows, kbs, skills, execRunning] =
        await Promise.all([
          this.prisma.organization.count(),
          this.prisma.user.count(),
          this.prisma.agent.count(),
          this.prisma.workflow.count(),
          this.prisma.knowledgeBase.count(),
          this.prisma.skill.count(),
          this.prisma.execution.count({ where: { status: 'running' } }),
        ]);
      this.entityGauge.set({ entity: 'organization' }, orgs);
      this.entityGauge.set({ entity: 'user' }, users);
      this.entityGauge.set({ entity: 'agent' }, agents);
      this.entityGauge.set({ entity: 'workflow' }, workflows);
      this.entityGauge.set({ entity: 'knowledge_base' }, kbs);
      this.entityGauge.set({ entity: 'skill' }, skills);
      this.entityGauge.set({ entity: 'execution_running' }, execRunning);
    } catch (e: any) {
      this.logger.warn(`[Metrics] refresh entity gauges failed: ${e?.message}`);
    }
  }

  // ==================== 前端看板用的 JSON 摘要 ====================

  /**
   * 给运维看板用的聚合视图（直接查库，与 Prometheus 无关，
   * 这样即使没部署 Prometheus 也能看到基本运行态势）。
   */
  async summary(organizationId: string, hours = 24) {
    const since = new Date(Date.now() - hours * 3600_000);

    const [
      execTotal,
      execSuccess,
      execFailed,
      execRunning,
      toolTotal,
      toolFailed,
      toolAvg,
      apiKeyActive,
      entityCounts,
      recentExecutions,
    ] = await Promise.all([
      this.prisma.execution.count({ where: { organizationId, startedAt: { gte: since } } }),
      this.prisma.execution.count({
        where: { organizationId, startedAt: { gte: since }, status: 'success' },
      }),
      this.prisma.execution.count({
        where: { organizationId, startedAt: { gte: since }, status: 'failed' },
      }),
      this.prisma.execution.count({ where: { organizationId, status: 'running' } }),
      this.prisma.toolInvocation.count({
        where: { organizationId, createdAt: { gte: since } },
      }),
      this.prisma.toolInvocation.count({
        where: { organizationId, createdAt: { gte: since }, status: 'error' },
      }),
      this.prisma.toolInvocation.aggregate({
        where: { organizationId, createdAt: { gte: since } },
        _avg: { durationMs: true },
      }),
      this.prisma.apiKey.count({ where: { organizationId, status: 'active' } }),
      Promise.all([
        this.prisma.agent.count({ where: { organizationId } }),
        this.prisma.workflow.count({ where: { organizationId } }),
        this.prisma.knowledgeBase.count({ where: { organizationId } }),
        this.prisma.skill.count({ where: { organizationId } }),
      ]),
      this.prisma.execution.findMany({
        where: { organizationId, startedAt: { gte: since } },
        select: { startedAt: true, finishedAt: true, status: true },
        orderBy: { startedAt: 'desc' },
        take: 500,
      }),
    ]);

    // 按小时分桶，画趋势线
    const buckets = new Map<string, { hour: string; success: number; failed: number }>();
    for (let i = hours - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 3600_000);
      const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      buckets.set(key, { hour: key, success: 0, failed: 0 });
    }
    let durationSum = 0;
    let durationCount = 0;
    for (const e of recentExecutions) {
      // startedAt 在 schema 里可空（排队中的执行还未开始），跳过避免 Invalid Date
      if (!e.startedAt) continue;
      const d = new Date(e.startedAt);
      const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
      const b = buckets.get(key);
      if (b) {
        if (e.status === 'failed') b.failed++;
        else b.success++;
      }
      if (e.finishedAt) {
        durationSum += new Date(e.finishedAt).getTime() - new Date(e.startedAt).getTime();
        durationCount++;
      }
    }

    const [agentCount, workflowCount, kbCount, skillCount] = entityCounts;

    return {
      windowHours: hours,
      execution: {
        total: execTotal,
        success: execSuccess,
        failed: execFailed,
        running: execRunning,
        successRate: execTotal ? Math.round((execSuccess / execTotal) * 1000) / 10 : null,
        avgDurationMs: durationCount ? Math.round(durationSum / durationCount) : null,
      },
      tool: {
        total: toolTotal,
        failed: toolFailed,
        avgDurationMs: toolAvg._avg.durationMs ? Math.round(toolAvg._avg.durationMs) : null,
      },
      entity: {
        agent: agentCount,
        workflow: workflowCount,
        knowledgeBase: kbCount,
        skill: skillCount,
        apiKeyActive,
      },
      trend: Array.from(buckets.values()),
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        nodeVersion: process.version,
      },
    };
  }
}
