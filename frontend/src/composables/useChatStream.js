import { ref } from 'vue';
import { chatStream } from '@/api/agent';

/**
 * 流式对话 composable
 * 用法：
 *   const { messages, send, isStreaming, abort } = useChatStream(agentId);
 *   send('你好');
 */
export function useChatStream(agentId) {
  const messages = ref([]); // [{role: 'user'|'assistant', content: string, time}]
  const isStreaming = ref(false);
  const conversationId = ref(null);
  const error = ref(null);

  let controller = null;

  function send(text) {
    if (!text || isStreaming.value) return;

    messages.value.push({ role: 'user', content: text, time: Date.now() });
    messages.value.push({ role: 'assistant', content: '', time: Date.now() });
    const aiIdx = messages.value.length - 1;

    isStreaming.value = true;
    error.value = null;

    controller = chatStream(agentId, {
      message: text,
      conversationId: conversationId.value || undefined,
    }, {
      onConversationId: (cid) => {
        conversationId.value = cid;
      },
      onDelta: (delta) => {
        messages.value[aiIdx].content += delta;
      },
      onDone: () => {
        isStreaming.value = false;
        controller = null;
      },
      onError: (msg) => {
        error.value = msg;
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
  }

  function clear() {
    abort();
    messages.value = [];
    conversationId.value = null;
    error.value = null;
  }

  return { messages, send, isStreaming, conversationId, error, abort, clear };
}