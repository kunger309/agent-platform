import { Injectable, Logger } from '@nestjs/common';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import { Readable } from 'stream';

export interface StreamChatOptions {
  llm: BaseChatModel;
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemPrompt?: string;
}

export interface StreamChatResult {
  stream: Readable;
  getAccumulated: () => string;
}

/**
 * 聊天引擎（LLM 能力层，供 agents / 通用对话共用）
 * - 直接调用 ChatModel（不带 Tools，不带 Memory）
 * - 历史从外部传入
 * - 输出：SSE 格式（data: {delta:'xxx'}\n\n）
 *   - 同时累积完整回复到内存，调用方通过 getAccumulated() 拿到
 */
@Injectable()
export class ChatEngine {
  private readonly logger = new Logger(ChatEngine.name);

  async streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
    const { llm, history, systemPrompt } = options;

    const messages: BaseMessage[] = [];
    if (systemPrompt) messages.push(new SystemMessage(systemPrompt));
    for (const m of history) {
      if (m.role === 'user') messages.push(new HumanMessage(m.content));
      else if (m.role === 'assistant') messages.push(new AIMessage(m.content));
      else if (m.role === 'system') messages.push(new SystemMessage(m.content));
    }

    const out = new Readable({ read() {} });
    let accumulated = '';

    (async () => {
      try {
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
            accumulated += text;
            out.push(`data: ${JSON.stringify({ delta: text })}\n\n`);
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
        out.push(
          `data: ${JSON.stringify({ error: err?.message || String(err) })}\n\n`,
        );
        out.push(null);
      }
    })();

    return { stream: out, getAccumulated: () => accumulated };
  }
}
