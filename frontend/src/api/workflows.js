/**
 * 工作流 API 封装
 * - REST：列表 / 详情 / 创建 / 更新 / 发布 / 删除 / 执行记录
 * - 运行：runWorkflowStream（SSE 流式，复用与 chatStream 相同的解析模式）
 */
import client from './client';

export const listWorkflows = () => client.get('/workflows');
/** 仅返回已发布工作流（用于智能体绑定下拉）。后端 /api/workflows/published 独立端点。 */
export const listPublishedWorkflows = () => client.get('/workflows/published');
export const getWorkflow = (id) => client.get(`/workflows/${id}`);
export const createWorkflow = (data) => client.post('/workflows', data);
export const updateWorkflow = (id, data) => client.patch(`/workflows/${id}`, data);
export const publishWorkflow = (id) => client.post(`/workflows/${id}/publish`, {});
export const deleteWorkflow = (id) => client.delete(`/workflows/${id}`);
export const listExecutions = (id) => client.get(`/workflows/${id}/executions`);
export const getExecution = (id, eid) => client.get(`/workflows/${id}/executions/${eid}`);

/**
 * 运行工作流（SSE 流式）
 * @param {string} id 工作流 ID
 * @param {string} input 测试输入
 * @param {object} callbacks { onRunStart, onNodeStart, onNodeToken, onNodeEnd, onDone, onError }
 * @returns {AbortController}
 */
export function runWorkflowStream(id, input, callbacks = {}) {
  const controller = new AbortController();
  const token = localStorage.getItem('agent_platform_token');
  fetch(`/api/workflows/${id}/runs`, {
    method: 'POST',
    headers: {
      Authorization: token ? `Bearer ${token}` : '',
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: input || '' }),
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
            if (data.thinking) {
              // keepalive 心跳，忽略
              continue;
            }
            switch (data.type) {
              case 'run_start':
                callbacks.onRunStart?.(data);
                break;
              case 'node_start':
                callbacks.onNodeStart?.(data);
                break;
              case 'node_token':
                callbacks.onNodeToken?.(data);
                break;
              case 'node_end':
                callbacks.onNodeEnd?.(data);
                break;
              case 'done':
                callbacks.onDone?.(data);
                break;
              case 'error':
                callbacks.onError?.(data.message || '运行出错');
                break;
              default:
                break;
            }
          } catch (_) {
            /* 忽略单行解析错误 */
          }
        }
      }
      callbacks.onDone?.(null);
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        callbacks.onError?.(err.message || String(err));
      }
    });

  return controller;
}
