import { Injectable, Logger } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  BaseMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { Readable } from 'stream';

/**
 * 一个可被 LLM 调用的工具定义（供 bindTools + 工具循环使用）
 */
export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema：传给 LLM 的参数描述 */
  schema: Record<string, any>;
  /** 执行工具，返回字符串结果（会被原样回灌给 LLM） */
  execute: (args: any) => Promise<string>;
}

export interface StreamChatOptions {
  llm: BaseChatModel;
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPrompt?: string;
  /** 可用工具；提供后启用工具调用循环 */
  tools?: ChatTool[];
  /** 工具循环最大轮数，防失控，默认 5 */
  maxToolRounds?: number;
}

export interface ToolCallRecord {
  name: string;
  args: any;
  result: string;
}

export interface StreamChatResult {
  stream: Readable;
  getAccumulated: () => string;
  getToolCalls: () => ToolCallRecord[];
}

/**
 * 聊天引擎（LLM 能力层，供 agents / 通用对话共用）
 * - 无 tools：直接流式输出（与原行为一致）
 * - 有 tools：bindTools + invoke 检测 tool_calls → 执行 → 回灌 → 直到无 tool_calls → 流式输出最终答案
 */
@Injectable()
export class ChatEngine {
  private readonly logger = new Logger(ChatEngine.name);

  async streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
    const { llm, history, systemPrompt, tools, maxToolRounds = 5 } = options;

    const messages: BaseMessage[] = [];
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));
    for (const m of history) {
      if (m.role === 'user') messages.push(new HumanMessage(m.content));
      else if (m.role === 'assistant') messages.push(new AIMessage(m.content));
      else if (m.role === 'system') messages.push(new SystemMessage(m.content));
    }

    const out = new Readable({ read() {} });
    let accumulated = '';
    const toolCalls: ToolCallRecord[] = [];

    (async () => {
      try {
        if (!tools || tools.length === 0) {
          await this.streamFinal(llm, messages, out, (t) => (accumulated += t));
        } else {
          const llmWithTools = (llm as any).bindTools(
            tools.map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.schema,
              },
            })),
          );

          let rounds = 0;
          while (rounds < maxToolRounds) {
            const ai: any = await llmWithTools.invoke(messages);
            messages.push(ai);
            const calls = ai?.tool_calls || [];
            if (!calls.length) {
              // 无工具调用 → 这是最终回答，流式输出
              await this.streamFinal(llm, messages, out, (t) => (accumulated += t));
              break;
            }
            // 执行每个工具调用
            for (const call of calls) {
              const tool = tools.find((t) => t.name === call.name);
              let result = '';
              try {
                result = tool ? await tool.execute(call.args || {}) : 'Unknown tool: ' + call.name;
              } catch (e: any) {
                result = 'Tool execution error: ' + (e?.message || String(e));
                this.logger.warn(`[ChatEngine] tool ${call.name} failed: ${result}`);
              }
              toolCalls.push({ name: call.name, args: call.args || {}, result });
              messages.push(
                new ToolMessage({ content: result, tool_call_id: call.id }),
              );
            }
            rounds++;
          }
          if (rounds >= maxToolRounds) {
            this.logger.warn('[ChatEngine] 工具循环达到上限，强制结束');
          }
        }
        out.push(`data: ${JSON.stringify({ done: true })}\n\n`);
        out.push(null);
      } catch (err: any) {
        this.logger.error(
          `[ChatEngine] stream error: ${err?.message}\nstatus=${err?.response?.status ?? err?.status}\ndata=${JSON.stringify(
            err?.response?.data ?? err?.error ?? null,
          )}\ncause=${err?.cause?.message ?? ''}`,
        );
        out.push(`data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`);
        out.push(null);
      }
    })();

    return {
      stream: out,
      getAccumulated: () => accumulated,
      getToolCalls: () => toolCalls,
    };
  }

  /**
   * 流式输出最终答案（无工具时直接走这里）
   */
  private async streamFinal(
    llm: BaseChatModel,
    messages: BaseMessage[],
    out: Readable,
    onText: (text: string) => void,
  ) {
    const stream = await llm.stream(messages);
    for await (const chunk of stream) {
      const text =
        typeof chunk.content === 'string'
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content
                .map((c: any) => (typeof c === 'string' ? c : c.text ?? ''))
                .join('')
            : '';
      if (text) {
        onText(text);
        out.push(`data: ${JSON.stringify({ delta: text })}\n\n`);
      }
    }
  }
}
