import { interpolate } from './interpolate';
import type { HandlerCtx, HandlerResult } from './types';

/**
 * 各节点处理器的统一入口。每个处理器返回一个 state 增量（update，交给 LangGraph reducer 合并）
 * 以及一份 output（用于运行时事件展示）。
 *
 * 注意：update 里的数组型通道（如 messages）只需返回"新增部分"，reducer 会做 concat，
 * 不要返回 current + 新增，否则会重复。
 */

// ============ LLM 节点 ============
// 复用 LlmService 解密 Provider + ChatEngine 流式；支持 promptTemplate / systemPrompt / providerId / model
export async function handleLLM(ctx: HandlerCtx): Promise<HandlerResult> {
  const { state, config, deps, nodeId } = ctx;
  const prompt = interpolate(config?.promptTemplate || '{{input}}', state);
  const system = config?.systemPrompt || undefined;

  // 解析 Provider
  let provider: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (config?.providerId) {
    provider = await deps.llm.getDecrypted(config.providerId);
    if (provider.organizationId && provider.organizationId !== deps.orgId) {
      throw new Error('指定的模型提供商不属于当前组织');
    }
  } else {
    provider = await deps.llm.getDefault(deps.orgId);
    if (!provider) throw new Error('尚未配置可用的模型提供商（请在「模型提供商」中设置）');
  }

  const chatModel = deps.llm.createChatModel(
    {
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      defaultModel: provider.defaultModel,
      models: provider.models,
    },
    config?.model,
  );

  const { stream, getAccumulated } = await deps.chatEngine.streamChat({
    llm: chatModel,
    history: [{ role: 'user', content: prompt }],
    systemPrompt: system,
  });

  let acc = '';
  await new Promise<void>((resolve) => {
    stream.on('data', (chunk: Buffer) => {
      try {
        const text = chunk.toString();
        const re = /data:\s*(\{.*\})\n\n/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const json = JSON.parse(m[1]);
          if (json.delta) {
            acc += json.delta;
            deps.emit({ type: 'node_token', nodeId, delta: json.delta });
          }
        }
      } catch {
        /* 忽略单块解析错误 */
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', () => resolve());
  });

  const full = getAccumulated() || acc;
  // MiniMax 等模型会输出 <think>...</think> 推理块，剥离后：
  // 1) 下游 answer / 插值展示更干净；2) 基于 LLM 输出做 condition 判断时不再被推理文本干扰
  const clean = stripThink(full);
  return {
    update: {
      output: clean,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: clean },
      ],
      variables: { last_llm: clean },
    },
    output: { content: clean },
  };
}

// 去除 <think>...</think> 推理块（可能存在多个 / 换行形式）
function stripThink(text: string): string {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ============ Answer 节点 ============
// 把模板（默认 {{input}}）作为最终输出写回 state.output；通常连到 END
// 同时按"流式"节奏 emit node_token，让对话场景的用户能看到打字机效果
export async function handleAnswer(ctx: HandlerCtx): Promise<HandlerResult> {
  const { state, config, deps, nodeId } = ctx;
  const out = interpolate(config?.template || '{{input}}', state);

  // 流式 emit（按 3 字符 / 25ms 一批）——用于 chat 场景下展示打字机。
  // emit 失败时降级，不影响最终 state.output。
  // 仅在 deps.emit 存在且输出非空时执行。
  if (deps?.emit && out) {
    try {
      const CHUNK = 3; // 每批字符数
      const INTERVAL = 25; // ms
      for (let i = 0; i < out.length; i += CHUNK) {
        const text = out.slice(i, i + CHUNK);
        deps.emit({ type: 'node_token', nodeId, delta: text });
        // 同步阻塞会让 LangGraph 状态推进更可预测；这里用 setTimeout 异步即可
        await new Promise((r) => setTimeout(r, INTERVAL));
      }
    } catch (e: any) {
      // 流式 emit 失败不影响最终结果
    }
  }

  return {
    update: { output: out, variables: { answer: out } },
    output: out,
  };
}

// ============ Condition 节点 ============
// 根据 operand(默认 output) 与 operator/value 求值布尔，写入 variables.__branch，
// 由编译器的 addConditionalEdges 据此路由到 true/false 分支
export async function handleCondition(ctx: HandlerCtx): Promise<HandlerResult> {
  const { state, config } = ctx;
  const left = resolveOperand(config?.variable || 'output', state);
  const op: string = config?.operator || 'truthy';
  const right = config?.value;
  let branch = false;
  switch (op) {
    case 'contains':
      branch = String(left ?? '').includes(String(right ?? ''));
      break;
    case 'not_contains':
      branch = !String(left ?? '').includes(String(right ?? ''));
      break;
    case 'equals':
      branch = String(left ?? '') === String(right ?? '');
      break;
    case 'not_equals':
      branch = String(left ?? '') !== String(right ?? '');
      break;
    case 'regex':
      try {
        branch = new RegExp(String(right ?? '')).test(String(left ?? ''));
      } catch {
        branch = false;
      }
      break;
    case 'truthy':
      branch = !!left && left !== 'false' && left !== '0' && left !== '';
      break;
    case 'falsy':
      branch = !left || left === 'false' || left === '0' || left === '';
      break;
    default:
      branch = !!left;
  }
  return {
    update: { variables: { __branch: branch } },
    output: { branch },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveOperand(spec: string, state: any): any {
  if (!spec || spec === 'output') return state.output;
  if (spec === 'input') return state.input;
  if (spec.startsWith('variables.')) return state.variables?.[spec.slice('variables.'.length)];
  if (spec.startsWith('artifacts.')) return state.artifacts?.[spec.slice('artifacts.'.length)];
  return state[spec];
}

// ============ Tool 节点（模板变换，安全） ============
// 对输入/变量做字符串模板插值，常用于把 LLM 输出格式化后传给下游
export async function handleTool(ctx: HandlerCtx): Promise<HandlerResult> {
  const { state, config } = ctx;
  const out = interpolate(config?.template || '{{input}}', state);
  return {
    update: { output: out, variables: { tool_out: out } },
    output: out,
  };
}

// ============ HTTP 节点（真实请求） ============
// 对 url/body 做插值后发起 fetch，结果存入 variables.http_body / output
export async function handleHttp(ctx: HandlerCtx): Promise<HandlerResult> {
  const { state, config } = ctx;
  const url = interpolate(config?.url || '', state);
  const method = (config?.method || 'POST').toUpperCase();
  const headers: Record<string, string> = config?.headers || {};
  let body: string | undefined;
  if (config?.bodyTemplate) body = interpolate(config.bodyTemplate, state);

  const init: RequestInit = { method, headers: { ...headers } };
  if (body && method !== 'GET' && method !== 'HEAD') {
    init.body = body;
    if (!headers['Content-Type'] && !headers['content-type']) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    }
  }

  const resp = await fetch(url, init);
  const text = await resp.text();
  let parsed: any = text; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    parsed = JSON.parse(text);
  } catch {
    /* 非 JSON，保留原文 */
  }
  const out = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  return {
    update: {
      output: out,
      variables: { http_status: resp.status, http_body: parsed },
    },
    output: { status: resp.status, body: parsed },
  };
}

// ============ Code 节点（简单沙箱，Phase 4 再上真实沙箱） ============
// 通过 new Function 执行用户代码，入参 input/output/variables/artifacts，返回值作为 output
export async function handleCode(ctx: HandlerCtx): Promise<HandlerResult> {
  const { state, config } = ctx;
  const code = config?.code || 'return input;';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = new Function('input', 'output', 'variables', 'artifacts', code) as any;
  let result: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    result = fn(state.input, state.output, state.variables, state.artifacts);
    if (result && typeof result.then === 'function') result = await result;
  } catch (e: any) {
    throw new Error('Code 节点执行失败: ' + (e?.message || String(e)));
  }
  const out = typeof result === 'object' && result !== null ? JSON.stringify(result) : String(result ?? '');
  return {
    update: { output: out, variables: { code_out: out } },
    output: out,
  };
}

// ============ KB 节点（混合检索：向量 + BM25 + RRF） ============
// config: { kbId: string, query?: string, topK?: number, scoreThreshold?: number }
// - query 默认 {{input}}，支持 {{变量}} 插值
// - 调 deps.retrievers.retrieve(orgId, kbId, query, {topK, scoreThreshold})
// - 双输出：
//   1) state.output  → markdown 文本块，直接喂下游 LLM 节点做 RAG
//   2) state.variables.kb_results → JSON 完整结果，供 code / condition 节点使用
export async function handleKb(ctx: HandlerCtx): Promise<HandlerResult> {
  const { state, config, deps, nodeId } = ctx;
  if (!deps.retrievers) {
    throw new Error('KB 节点需要 RetrieversService，但 deps.retrievers 未注入');
  }
  const kbId = config?.kbId;
  if (!kbId) throw new Error('KB 节点未配置 kbId');

  const query = interpolate(config?.query || '{{input}}', state).trim();
  if (!query) throw new Error('KB 节点检索 query 为空');

  const topK = Math.min(50, Math.max(1, Number(config?.topK ?? 5)));
  const scoreThreshold = Math.min(1, Math.max(0, Number(config?.scoreThreshold ?? 0)));

  const result = await deps.retrievers.retrieve(deps.orgId, kbId, query, {
    topK,
    scoreThreshold,
  });

  // 拼成 markdown 文本块（喂 LLM 用），便于 RAG prompt 拼接
  const blocks = result.results.map((r: any, i: number) => {
    const src = (r.sources || []).join('+');
    const vec = r.vectorScore != null ? r.vectorScore.toFixed(4) : '-';
    const bm = r.bm25Score != null ? r.bm25Score.toFixed(4) : '-';
    const head = `[${i + 1}] (来源: ${src || '-'}, RRF=${r.score.toFixed(4)}, vec=${vec}, bm25=${bm})`;
    const body = (r.content || '').replace(/\s+/g, ' ').trim();
    return `${head}\n${body}`;
  });
  const md =
    blocks.length > 0
      ? `[知识库检索结果] 共 ${result.total} 条命中（topK=${result.topK}）：\n\n${blocks.join('\n\n')}`
      : `[知识库检索结果] 未命中任何内容`;

  return {
    update: {
      output: md,
      variables: {
        kb_results: result,
        kb_total: result.total,
        kb_query: result.query,
      },
    },
    // output 也走结构化版本，让前端 / 调试面板能直接展示 hits
    output: { query: result.query, total: result.total, hits: result.results },
  };
}
