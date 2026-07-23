/**
 * 通用对话（不绑定 Agent，用默认 Provider）
 * @param {string} message 当前消息
 * @param {Array<{role:string,content:string}>} history 历史（不含当前这条）
 * @param {object} callbacks { onDelta, onDone, onError }
 * @returns {AbortController}
 */
export function chatStream(message, history = [], callbacks = {}) {
  const controller = new AbortController();
  const token = localStorage.getItem('agent_platform_token');

  fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message, history }),
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
            if (data.delta !== undefined) callbacks.onDelta?.(data.delta);
            else if (data.done) callbacks.onDone?.();
            else if (data.error) callbacks.onError?.(data.error);
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
