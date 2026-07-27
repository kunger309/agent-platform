import client from './client';

export const listAgents = () => client.get('/agents');
export const getAgent = (id) => client.get(`/agents/${id}`);
export const createAgent = (data) => client.post('/agents', data);
export const updateAgent = (id, data) => client.patch(`/agents/${id}`, data);
export const deleteAgent = (id) => client.delete(`/agents/${id}`);

/**
 * 流式对话（使用 fetch + ReadableStream）
 * @param {string} agentId
 * @param {object} payload { message, conversationId? }
 * @param {object} callbacks { onDelta, onConversationId, onDone, onError }
 * @returns {AbortController} 用于中断
 */
export function chatStream(agentId, payload, callbacks = {}) {
  const controller = new AbortController();
  const token = localStorage.getItem('agent_platform_token');

  fetch(`/api/agents/${agentId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          msg = data?.message || msg;
        } catch (_) {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // 拆 SSE 事件
        const events = buf.split('\n\n');
        buf = events.pop() || '';
        for (const evt of events) {
          const line = evt.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const data = JSON.parse(json);
            if (data.conversationId) {
              callbacks.onConversationId?.(data.conversationId);
            } else if (data.thinking) {
              // 后端 keepalive 心跳：模型还在思考中
              callbacks.onThinking?.();
            } else if (data.delta !== undefined) {
              callbacks.onDelta?.(data.delta);
            } else if (data.done) {
              callbacks.onDone?.();
            } else if (data.error) {
              callbacks.onError?.(data.error);
            }
          } catch (_) {}
        }
      }
      callbacks.onDone?.();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError?.(err.message || String(err));
      }
    });

  return controller;
}