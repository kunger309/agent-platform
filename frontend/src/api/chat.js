/**
 * 通用对话（不绑定 Agent，用默认 Provider，支持会话持久化 + 文件上传 + 工作流模式 + KB 检索注入）
 * @param {string} message 当前消息
 * @param {string} [conversationId] 可选；传入则复用会话
 * @param {object} callbacks { onConversationId, onThinking, onSources, onDelta, onDone, onError, onRetry, onInterrupted }
 *   onSources(items) 在首个 delta 之前触发，items = [{ kbId, kbName, documentId, documentName, chunkIndex, content, score, ... }]
 *   onRetry(n, delay) 断线自动重连（仅在尚未产生任何内容时触发）
 *   onInterrupted(chars) 已输出部分内容后断流，无法安全重放，需用户手动重发
 * @param {File[]} [files] 可选；传入则改用 multipart/form-data 上传
 * @param {string} [workflowId] 可选；传入则改用工作流引擎作为后端
 * @param {string[]} [kbIds] 可选；关联知识库；非空时后端会自动做混合检索并把命中片段喂给 LLM
 * @returns {{ abort: () => void }}
 */
import client from './client';
import { sseStream } from '@/utils/sse-stream';

export function chatStream(message, conversationId, callbacks = {}, files = [], workflowId = '', kbIds = []) {
  const token = localStorage.getItem('agent_platform_token');
  const useMultipart = !!(files && files.length);

  const headers = { Authorization: token ? `Bearer ${token}` : '' };
  if (!useMultipart) headers['Content-Type'] = 'application/json';

  // 工厂函数：重连时必须重新构造 body（FormData / ReadableStream 只能被消费一次）
  const makeBody = () => {
    if (useMultipart) {
      // 带附件：multipart/form-data（浏览器自动设置 Content-Type + boundary）
      const fd = new FormData();
      fd.append('message', message);
      if (conversationId) fd.append('conversationId', conversationId);
      if (workflowId) fd.append('workflowId', workflowId);
      // 始终显式提交（包括 []），让后端能区分"沿用旧关联"和"用户已清空关联"。
      fd.append('kbIds', JSON.stringify(Array.isArray(kbIds) ? kbIds : []));
      files.forEach((f) => fd.append('files', f));
      return fd;
    }
    return JSON.stringify({
      message,
      conversationId,
      workflowId: workflowId || undefined,
      kbIds: Array.isArray(kbIds) ? kbIds : [],
    });
  };

  // 业务层错误（data.error）出现后就不要再回调 onDone，否则 UI 的错误态会被"正常结束"覆盖
  let errored = false;

  return sseStream({
    url: '/api/chat',
    headers,
    makeBody,
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
      } else if (data.sources) {
        // KB 检索来源（首个 delta 之前触发），挂到当前 assistant 消息上
        callbacks.onSources?.(data.sources);
      } else if (data.thinking) {
        // 后端 keepalive 心跳：模型还在思考中
        callbacks.onThinking?.();
      } else if (data.delta !== undefined) {
        callbacks.onDelta?.(data.delta);
      } else if (data.done) {
        // 由 onFinish 统一收口，避免 done 事件 + 流结束触发两次 onDone
      } else if (data.error) {
        errored = true;
        callbacks.onError?.(data.error);
      }
    },
  });
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
