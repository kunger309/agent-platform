import { Annotation } from '@langchain/langgraph';

/**
 * 工作流图的共享状态（GraphState）
 * - input:      整个图运行的输入（用户测试输入）
 * - output:     最终输出（通常由 Answer 节点赋值）
 * - messages:   节点产出的消息快照（仅观测用，不影响节点逻辑）
 * - variables:  节点间传递的变量（reducer 合并；__branch 为条件路由结果）
 * - artifacts:  产物（reducer 合并）
 * - currentStep:当前节点 id（观测用）
 */
export const GraphState = Annotation.Root({
  input: Annotation(),
  output: Annotation(),
  messages: Annotation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reducer: (a: any[], b: any[]) => a.concat(b),
    default: () => [] as any[],
  }),
  variables: Annotation({
    reducer: (a: Record<string, any>, b: Record<string, any>) => ({ ...a, ...b }),
    default: () => ({}) as Record<string, any>,
  }),
  artifacts: Annotation({
    reducer: (a: Record<string, any>, b: Record<string, any>) => ({ ...a, ...b }),
    default: () => ({}) as Record<string, any>,
  }),
  currentStep: Annotation(),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GraphStateShape = {
  input: string;
  output: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  variables: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  artifacts: Record<string, any>;
  currentStep: string;
};
