import client from './client';
import { sseStream } from '@/utils/sse-stream';

export const listAgents = () => client.get('/agents');
export const getAgent = (id) => client.get(`/agents/${id}`);
export const createAgent = (data) => client.post('/agents', data);
export const updateAgent = (id, data) => client.patch(`/agents/${id}`, data);
export const deleteAgent = (id) => client.delete(`/agents/${id}`);

/**
 * 智能体流式对话（fetch + ReadableStream，带断线自动重连）
 *
 * 重连语义见 utils/sse-stream.js：
 *   - 未产生任何内容时断线 → 自动重试（最多 3 次，指数退避）
 *   - 已输出部分内容后断线 → 触发 onInterrupted，不自动重放（避免重复内容与重复计费）
 *
 * @param {string} agentId
 * @param {object} payload { message, conversationId? }
 * @param {object} callbacks { onDelta, onConversationId, onThinking, onDone, onError, onRetry, onInterrupted }
 * @returns {{ abort: () => void }} 用于中断
 */
export function chatStream(agentId, payload, callbacks = {}) {
  const token = localStorage.getItem('agent_platform_token');
  let errored = false;

  return sseStream({
    url: `/api/agents/${agentId}/chat`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    makeBody: () => JSON.stringify(payload),
    onRetry: (n, delay) => callbacks.onRetry?.(n, delay),
    onInterrupted: (chars) => {
      callbacks.onInterrupted?.(chars);
      if (!errored) callbacks.onDone?.();
    },
    onError: (msg) => { errored = true; callbacks.onError?.(msg); },
    onFinish: () => { if (!errored) callbacks.onDone?.(); },
    onEvent: (data) => {
      if (data.conversationId) {
        callbacks.onConversationId?.(data.conversationId);
      } else if (data.thinking) {
        // 后端 keepalive 心跳：模型还在思考中
        callbacks.onThinking?.();
      } else if (data.delta !== undefined) {
        // dedup 标记:workflow 智能体的 delta 带 dedup=true,前端 includes 去重;
        // chat 智能体的 delta 不带 dedup,直接累加,不受影响。
        callbacks.onDelta?.(data.delta, { dedup: data.dedup });
      } else if (data.done) {
        // 由 onFinish 统一收口
      } else if (data.error) {
        errored = true;
        callbacks.onError?.(data.error);
      }
    },
  });
}
