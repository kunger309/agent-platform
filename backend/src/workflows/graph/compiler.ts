import { StateGraph, START, END } from '@langchain/langgraph';
import { GraphState } from './state';
import type { GraphJson, NodeType, RunDeps, HandlerCtx, HandlerResult } from './types';
import * as handlers from './handlers';

// 节点类型 → 处理器
const HANDLER_MAP: Record<string, (ctx: HandlerCtx) => Promise<HandlerResult>> = {
  llm: handlers.handleLLM,
  answer: handlers.handleAnswer,
  condition: handlers.handleCondition,
  tool: handlers.handleTool,
  http: handlers.handleHttp,
  code: handlers.handleCode,
  kb: handlers.handleKb,
};

interface CompiledRun {
  output: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variables: Record<string, any>;
  error?: string;
}

/**
 * 编译并运行一个工作流图。
 * - 把每个 vue-flow 节点映射为 LangGraph 节点函数（带事件发射 + 计时）
 * - 普通节点：addEdge(source, target)
 * - 条件节点：收集 true/false 两个分支 → addConditionalEdges
 * - 无入边的节点作为 START；无出边的节点连到 END
 * - 通过 emit 实时推送 run_start / node_start / node_token / node_end / done / error
 */
export async function runWorkflow(
  graph: GraphJson,
  deps: RunDeps,
  input: string,
): Promise<CompiledRun> {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];

  if (!nodes.length) {
    deps.emit({ type: 'run_start', runId: deps.runId, input });
    deps.emit({ type: 'done', output: '', variables: {} });
    return { output: '', variables: {} };
  }

  const nodeType = new Map<string, string>();

  // LangGraph 对动态节点名（字符串）类型推断过严，运行时图节点由用户定义，
  // 这里把方法签名放宽到接受任意 string，不影响实际编译运行。
  type LooseGraph = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addNode(name: string, fn: (state: any) => Promise<any>): LooseGraph;
    addEdge(from: string | typeof START, to: string | typeof END): LooseGraph;
    addConditionalEdges(
      source: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fn: (state: any) => string,
      mapping: Record<string, string>,
    ): LooseGraph;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compile(): any;
  };
  const g = new StateGraph(GraphState) as unknown as LooseGraph;

  for (const n of nodes) {
    const type: string = n.type || 'llm';
    nodeType.set(n.id, type);
    const cfg = n.data?.config || {};
    const fn = HANDLER_MAP[type] || handlers.handleLLM;
    g.addNode(n.id, makeNode(n.id, type, cfg, deps, fn));
  }

  // 条件节点的分支目标
  const conditionTargets: Record<string, { true: string | null; false: string | null }> = {};
  for (const e of edges) {
    if ((nodeType.get(e.source) || 'llm') === 'condition') {
      const branch = e.sourceHandle === 'false' ? 'false' : 'true';
      conditionTargets[e.source] = conditionTargets[e.source] || { true: null, false: null };
      conditionTargets[e.source][branch] = e.target;
    }
  }

  // 普通边
  for (const e of edges) {
    if ((nodeType.get(e.source) || 'llm') === 'condition') continue;
    const target = e.target === '__end__' ? END : e.target;
    g.addEdge(e.source, target);
  }

  // 条件边
  for (const [condId, branches] of Object.entries(conditionTargets)) {
    g.addConditionalEdges(
      condId,
      (s: any) => (s.variables?.__branch ? 'true' : 'false'), // eslint-disable-line @typescript-eslint/no-explicit-any
      {
        true: toTarget(branches.true),
        false: toTarget(branches.false),
      },
    );
  }

  // START：无入边的节点（优先 llm/answer）
  const startNode =
    nodes.find((n) => !edges.some((e) => e.target === n.id)) || nodes[0];
  if (startNode) g.addEdge(START, startNode.id);

  // END：无出边的节点（条件节点已通过 conditional edges 处理，跳过）
  const terminal = nodes.filter((n) => !edges.some((e) => e.source === n.id));
  for (const n of terminal) {
    if ((nodeType.get(n.id) || 'llm') === 'condition') continue;
    g.addEdge(n.id, END);
  }

  const app = g.compile();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const last: any = {
    input,
    output: '',
    messages: [],
    variables: {},
    artifacts: {},
    currentStep: '',
  };

  deps.emit({ type: 'run_start', runId: deps.runId, input });

  const stream = await app.stream(last, { streamMode: 'values' });
  for await (const vals of stream as any) {
    Object.assign(last, vals);
  }

  deps.emit({
    type: 'done',
    output: last.output || '',
    variables: last.variables || {},
  });

  return { output: last.output || '', variables: last.variables || {} };
}

// 在 runWorkflow 内部 try/catch 中捕获整体异常，转成 error 结果
export async function runWorkflowSafe(
  graph: GraphJson,
  deps: RunDeps,
  input: string,
): Promise<CompiledRun> {
  try {
    return await runWorkflow(graph, deps, input);
  } catch (e: any) {
    deps.emit({ type: 'error', nodeId: undefined, message: e?.message || String(e) });
    return { output: '', variables: {}, error: e?.message || String(e) };
  }
}

function toTarget(t: string | null): string {
  if (!t || t === '__end__') return END;
  return t;
}

// 把 handler 返回的输出收敛成"字符串"，供 {{nodeId.output}} 插值使用
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOutStr(output: any): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && output.content != null) return String(output.content);
  if (typeof output === 'object') return JSON.stringify(output);
  return String(output);
}

function makeNode(
  nodeId: string,
  type: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cfg: Record<string, any>,
  deps: RunDeps,
  fn: (ctx: HandlerCtx) => Promise<HandlerResult>,
) {
  return async (state: any) => {
    const started = Date.now();
    const inputSnapshot = {
      input: state.input,
      output: state.output,
      variables: state.variables,
    };
    deps.emit({
      type: 'node_start',
      nodeId,
      nodeType: type,
      label: cfg?.label,
      input: inputSnapshot,
    });
    try {
      const { update, output } = await fn({ state, config: cfg, deps, nodeId });
      deps.emit({
        type: 'node_end',
        nodeId,
        nodeType: type,
        output,
        durationMs: Date.now() - started,
      });
      // 统一把本节点输出字符串写入 variables[`${nodeId}.output`]，
      // 使下游可用 {{n1.output}} 这类"按节点引用"语法取到上游输出。
      const outStr = toOutStr(output);
      return {
        ...update,
        variables: { ...(update.variables || {}), [`${nodeId}.output`]: outStr },
      };
    } catch (e: any) {
      deps.emit({
        type: 'node_end',
        nodeId,
        nodeType: type,
        output: { error: e?.message || String(e) },
        durationMs: Date.now() - started,
      });
      deps.emit({ type: 'error', nodeId, message: e?.message || String(e) });
      throw e;
    }
  };
}

export type { NodeType };
