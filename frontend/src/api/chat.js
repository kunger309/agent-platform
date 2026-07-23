/**
 * 通用对话（不绑定 Agent，用默认 Provider，支持会话持久化 + 文件上传）
 * @param {string} message 当前消息
 * @param {string} [conversationId] 可选；传入则复用会话
 * @param {object} callbacks { onConversationId, onThinking, onDelta, onDone, onError }
 * @param {File[]} [files] 可选；传入则改用 multipart/form-data 上传
 * @returns {AbortController}
 */
import client from './client';

export function chatStream(message, conversationId, callbacks = {}, files = []) {
  const controller = new AbortController();
  const token = localStorage.getItem('agent_platform_token');

  let body;
  let headers = {
    Authorization: token ? `Bearer ${token}` : '',
    Accept: 'text/event-stream',
  };
  if (files && files.length) {
    // 带附件：multipart/form-data（浏览器自动设置 Content-Type + boundary）
    const fd = new FormData();
    fd.append('message', message);
    if (conversationId) fd.append('conversationId', conversationId);
    files.forEach((f) => fd.append('files', f));
    body = fd;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({ message, conversationId });
  }

  fetch('/api/chat', {
    method: 'POST',
    headers,
    body,
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

/** 列出当前用户的「智能对话」会话（client 已解包 data，直接返回数组） */
export function listConversations() {
  return client.get('/chat/conversations');
}

/** 获取某个会话的所有历史消息 */
export function getConversationMessages(conversationId) {
  return client.get(`/chat/conversations/${conversationId}/messages`);
}

/** 删除会话（级联删消息） */
export function deleteConversation(conversationId) {
  return client.delete(`/chat/conversations/${conversationId}`);
}
