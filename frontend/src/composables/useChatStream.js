import { ref } from 'vue';
import { chatStream } from '@/api/agent';

/**
 * 流式对话 composable（带断线重连状态）
 * 用法：
 *   const { messages, send, isStreaming, reconnecting, abort } = useChatStream(agentId);
 *   send('你好');
 */
export function useChatStream(agentId) {
  const messages = ref([]); // [{role: 'user'|'assistant', content: string, time}]
  const isStreaming = ref(false);
  const conversationId = ref(null);
  const error = ref(null);
  const reconnecting = ref(''); // 非空表示正在重连，内容为提示文案

  let controller = null;

  function send(text) {
    if (!text || isStreaming.value) return;

    messages.value.push({ role: 'user', content: text, time: Date.now() });
    messages.value.push({ role: 'assistant', content: '', time: Date.now() });
    const aiIdx = messages.value.length - 1;

    isStreaming.value = true;
    error.value = null;
    reconnecting.value = '';

    controller = chatStream(agentId, {
      message: text,
      conversationId: conversationId.value || undefined,
    }, {
      onConversationId: (cid) => {
        conversationId.value = cid;
      },
      onRetry: (n, delay) => {
        reconnecting.value = `连接中断，${Math.round(delay / 1000) || 1} 秒后第 ${n} 次重连…`;
      },
      onInterrupted: () => {
        // 已产生部分内容，重放会导致重复输出，只提示不自动重发
        messages.value[aiIdx].content += '\n\n> ⚠️ 连接中断，回答未输出完整，请重新发送。';
      },
      onDelta: (delta) => {
        reconnecting.value = '';
        messages.value[aiIdx].content += delta;
      },
      onDone: () => {
        reconnecting.value = '';
        isStreaming.value = false;
        controller = null;
      },
      onError: (msg) => {
        error.value = msg;
        reconnecting.value = '';
        messages.value[aiIdx].content += `\n\n[错误] ${msg}`;
        isStreaming.value = false;
        controller = null;
      },
    });
  }

  function abort() {
    controller?.abort();
    controller = null;
    isStreaming.value = false;
    reconnecting.value = '';
  }

  function clear() {
    abort();
    messages.value = [];
    conversationId.value = null;
    error.value = null;
  }

  return { messages, send, isStreaming, reconnecting, conversationId, error, abort, clear };
}
