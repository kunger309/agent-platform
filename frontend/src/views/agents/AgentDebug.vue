<template>
  <div class="agent-debug">
    <div class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" @click="goBack" plain size="small">返回</el-button>
        <h2 class="page-title">{{ agentName }} · 调试对话</h2>
      </div>
      <el-button @click="clearIt" :icon="Refresh" plain>清空对话</el-button>
    </div>

    <div class="chat-container">
      <div class="messages" ref="messagesRef">
        <div v-if="messages.length === 0" class="empty">
          <el-icon size="56" :color="themeStore.isDark ? '#3b4d66' : '#dcdfe6'"><ChatDotRound /></el-icon>
          <p class="empty-title">开始与 <b>{{ agentName }}</b> 对话吧</p>
          <p class="empty-hint">输入 Enter 发送，Shift+Enter 换行，Ctrl+Enter 也可发送</p>
        </div>

        <div
          v-for="(m, i) in parsedMessages"
          :key="i"
          :class="['msg', `msg-${m.role}`]"
        >
          <div class="msg-avatar">
            <el-avatar :size="36" :style="{ background: m.role === 'user' ? 'var(--brand-primary)' : 'var(--success)' }">
              {{ m.role === 'user' ? '我' : 'AI' }}
            </el-avatar>
          </div>
          <div class="msg-body">
            <div class="msg-meta">
              <span class="msg-role">{{ m.role === 'user' ? '我' : agentName }}</span>
              <span class="msg-time">{{ formatTime(m.time) }}</span>
            </div>
            <div class="msg-bubble">
              <template v-for="(p, pi) in m.parts" :key="pi">
                <ThinkingBlock
                  v-if="p.type === 'think'"
                  :content="p.content"
                  :streaming="m.isStreaming"
                />
                <MarkdownView
                  v-else
                  :content="p.content"
                  :streaming="m.isStreaming && pi === m.parts.length - 1"
                />
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="input-area">
        <div class="input-inner">
          <el-input
            v-model="input"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 8 }"
            :disabled="isStreaming"
            placeholder="输入消息后按 Ctrl+Enter 发送"
            @keydown.ctrl.enter="sendIt"
            @keydown.meta.enter="sendIt"
          />
          <div class="input-actions">
            <el-tag v-if="error" type="danger" size="small">{{ error }}</el-tag>
            <span v-if="isStreaming" class="streaming-hint">
              <el-icon class="rotating"><Loading /></el-icon>
              正在生成…
            </span>
            <el-button v-if="isStreaming" type="warning" @click="abort" plain>停止</el-button>
            <el-button
              v-else
              type="primary"
              @click="sendIt"
              :disabled="!input.trim()"
            >发送</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft, Refresh, ChatDotRound, MagicStick, Loading,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useChatStream } from '@/composables/useChatStream';
import { useThemeStore } from '@/stores/theme';
import ThinkingBlock from '@/components/chat/ThinkingBlock.vue';
import MarkdownView from '@/components/chat/MarkdownView.vue';

const route = useRoute();
const router = useRouter();
const themeStore = useThemeStore();
const agentId = route.params.id;
const agentName = route.query.name || '智能体';

const input = ref('');
const messagesRef = ref(null);
const { messages, send, isStreaming, error, abort, clear } = useChatStream(agentId);

/* 解析 <think>...</think> 块 */
const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;
function parseContent(raw) {
  if (!raw) return [{ type: 'text', content: '' }];
  const parts = [];
  let lastIdx = 0;
  let m;
  THINK_REGEX.lastIndex = 0;
  while ((m = THINK_REGEX.exec(raw)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ type: 'text', content: raw.slice(lastIdx, m.index) });
    }
    const thinkText = m[1].trim();
    if (thinkText) parts.push({ type: 'think', content: thinkText });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < raw.length) {
    parts.push({ type: 'text', content: raw.slice(lastIdx) });
  }
  return parts.length ? parts : [{ type: 'text', content: raw }];
}

const parsedMessages = computed(() =>
  messages.value.map((m, idx) => ({
    ...m,
    parts: parseContent(m.content),
    isStreaming:
      isStreaming.value && idx === messages.value.length - 1 && m.role === 'assistant',
  })),
);

function sendIt() {
  const text = input.value.trim();
  if (!text) return;
  send(text);
  input.value = '';
  nextTick(scrollToBottom);
}

function scrollToBottom() {
  const el = messagesRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function clearIt() {
  clear();
  ElMessage.success('已清空');
}

function goBack() {
  router.push('/agents');
}

function formatTime(t) {
  if (!t) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

watch(messages, () => nextTick(scrollToBottom), { deep: true });
onMounted(() => {});
</script>

<style scoped>
.agent-debug {
  padding: 0;
  height: calc(100vh - var(--topbar-height) - 2 * var(--content-padding));
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  max-width: var(--chat-max-width);
  width: 100%;
  margin-left: auto;
  margin-right: auto;
}
.header-left { display: flex; align-items: center; gap: 12px; }
.page-title {
  display: inline-block;
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  vertical-align: middle;
}

.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
  overflow: hidden;
  min-height: 0;
}

.messages {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  background: var(--surface-muted);
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.empty {
  text-align: center;
  padding: 80px 0;
  color: var(--text-placeholder);
}
.empty-title {
  font-size: 16px;
  margin: 16px 0 4px;
  color: var(--text-regular);
}
.empty-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
}

.msg { display: flex; gap: 12px; align-items: flex-start; }
.msg-user { flex-direction: row-reverse; }

.msg-avatar { flex-shrink: 0; }
.msg-body { max-width: var(--chat-max-width); min-width: 0; }
.msg-user .msg-body { display: flex; flex-direction: column; align-items: flex-end; }

.msg-meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.msg-user .msg-meta { justify-content: flex-end; }
.msg-role { font-weight: 600; color: var(--text-regular); }
.msg-time { color: var(--text-placeholder); }

.msg-bubble {
  position: relative;
  padding: 12px 16px;
  border-radius: 10px;
  line-height: 1.65;
  word-break: break-word;
  white-space: pre-wrap;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.msg-user .msg-bubble {
  background: var(--brand-gradient);
  color: var(--text-inverse);
  border-top-right-radius: 2px;
}
.msg-assistant .msg-bubble {
  background: var(--surface);
  color: var(--text-primary);
  border: 1px solid var(--border-light);
  border-top-left-radius: 2px;
}
.msg-text { margin: 0; }
.msg-text + .msg-text { margin-top: 8px; }

/* 思考过程折叠块 */
.think-block {
  background: var(--surface-soft);
  border: 1px dashed var(--border-base);
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.msg-user .think-block { display: none; }
.think-block summary {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 4px;
  outline: none;
}
.think-block summary::-webkit-details-marker { display: none; }
.think-len { color: var(--text-placeholder); font-size: 11px; }
.think-content {
  margin: 8px 0 0;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-regular);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow-y: auto;
}

/* 打字光标 */
.cursor-blink {
  display: inline-block;
  color: var(--brand-primary);
  animation: blink 1s steps(2) infinite;
  margin-left: 2px;
}
@keyframes blink { 50% { opacity: 0; } }

/* 输入区 */
.input-area {
  padding: 12px 24px;
  border-top: 1px solid var(--border-light);
  background: var(--surface);
}
.input-inner {
  max-width: var(--chat-max-width);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
}
.streaming-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--success);
  margin-right: auto;
}
.rotating { animation: rot 1.2s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }
</style>
