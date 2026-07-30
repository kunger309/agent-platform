import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { runJsInSandbox } from './js-sandbox';
import {
  parseOpenApiDocument,
  extractOpenApiTools,
  buildOpenApiRequest,
} from './openapi-parser';

export interface ExecuteResult {
  output: any;
  durationMs: number;
  status: 'success' | 'failed';
  error?: string;
}

export interface ExecuteOptions {
  /** 工作流执行 id（聊天场景下也是聊天的 executionId）；提供时落 ToolInvocation 记录（调用追踪） */
  executionId?: string;
  /** 关联的智能体 id（用于调用记录筛选） */
  agentId?: string;
  /** 调用人 userId */
  userId?: string;
  /** 组织 id */
  orgId?: string;
}

/**
 * 技能执行引擎：根据 SkillVersion 执行 function / openapi 两种类型。
 * - function：vm 沙箱执行 sourceCode
 * - openapi：解析文档 → 构造请求 → fetch
 * 统一记录耗时与成功/失败，可选落 ToolInvocation。
 */
@Injectable()
export class SkillExecutorService {
  private readonly logger = new Logger(SkillExecutorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async executeByVersion(
    version: any,
    input: any,
    opts: ExecuteOptions = {},
  ): Promise<ExecuteResult> {
    const started = Date.now();
    let status: 'success' | 'failed' = 'success';
    let output: any = null;
    let errorMsg: string | undefined;

    try {
      if (version?.skill?.type === 'function') {
        const timeout =
          (version.securityPolicy as any)?.maxDuration || 2000;
        output = runJsInSandbox(version.sourceCode || 'return input;', input ?? {}, timeout);
      } else if (version?.skill?.type === 'openapi') {
        output = await this.executeOpenApi(version, input ?? {});
      } else {
        throw new Error('未知技能类型: ' + version?.skill?.type);
      }
      // 确保可序列化（捕获循环引用等）
      if (output !== undefined && output !== null) JSON.stringify(output);
    } catch (e: any) {
      status = 'failed';
      errorMsg = e?.message || String(e);
      this.logger.warn(`[SkillExecutor] 技能执行失败: ${errorMsg}`);
    }

    const durationMs = Date.now() - started;

    if (opts.executionId) {
      try {
        await this.prisma.toolInvocation.create({
          data: {
            executionId: opts.executionId,
            skillId: version.skillId,
            agentId: opts.agentId ?? null,
            userId: opts.userId ?? null,
            organizationId: opts.orgId ?? null,
            inputJson: input ?? {},
            outputJson: output ?? null,
            status,
            durationMs,
            errorMessage: errorMsg,
          },
        });
      } catch (e: any) {
        this.logger.warn(`[SkillExecutor] 落 ToolInvocation 失败: ${e?.message}`);
      }
    }

    return { output, durationMs, status, error: errorMsg };
  }

  private async executeOpenApi(version: any, input: Record<string, any>): Promise<any> {
    if (!version.openapiSchema) throw new Error('该技能未配置 openapiSchema');
    const doc = parseOpenApiDocument(version.openapiSchema);
    const tools = extractOpenApiTools(doc);
    const opId = input.operation || tools[0].operationId;
    const spec =
      tools.find((t) => t.operationId === opId) ||
      tools.find((t) => t.name === opId) ||
      tools[0];
    if (!spec) throw new Error('未找到匹配的 OpenAPI 操作: ' + opId);

    const req = buildOpenApiRequest(spec, input);
    const resp = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
    });
    const text = await resp.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 非 JSON，保留原文 */
    }
    if (!resp.ok) {
      const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
      throw new Error(`HTTP ${resp.status}: ${detail}`);
    }
    return parsed;
  }
}
