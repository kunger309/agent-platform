// 工作流图相关的类型定义（前端 vue-flow JSON 与后端编译共享）

export type NodeType =
  | 'llm'
  | 'answer'
  | 'condition'
  | 'tool'
  | 'http'
  | 'code'
  | 'kb';

export interface GraphNodeData {
  label?: string;
  config?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface GraphNode {
  id: string;
  type?: string; // vue-flow 节点 type，映射到 NodeType
  data?: GraphNodeData;
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface GraphJson {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 运行期的依赖注入（由 controller/service 提供） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RunDeps {
  orgId: string;
  // LlmService：解密 Provider + 创建 ChatModel
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  llm: any;
  // ChatEngine：SSE 流式
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chatEngine: any;
  // RetrieversService：知识库混合检索（向量+BM25+RRF）。KB 节点使用。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  retrievers: any;
  // 事件发射（写入 SSE + 落 ExecutionLog）
  emit: (event: WorkflowEvent) => void;
  runId: string;
}

export type WorkflowEvent =
  | { type: 'run_start'; runId: string; input: string }
  | {
      type: 'node_start';
      nodeId: string;
      nodeType: string;
      label?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      input: any;
    }
  | { type: 'node_token'; nodeId: string; delta: string }
  | {
      type: 'node_end';
      nodeId: string;
      nodeType: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      output: any;
      durationMs: number;
    }
  | {
      type: 'done';
      output: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      variables: Record<string, any>;
    }
  | { type: 'error'; nodeId?: string; message: string };

/** 节点处理器统一签名 */
export interface HandlerCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
  deps: RunDeps;
  nodeId: string;
}

export interface HandlerResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: any;
}
