<template>
  <div class="chat-page">
    <div class="chat-shell">
      <!-- 左侧会话列表 -->
      <div class="chat-side">
        <div class="side-header">
          <el-button type="primary" size="small" :icon="Plus" @click="newSession" style="width: 100%">
            新建对话
          </el-button>
        </div>
        <div class="session-list">
          <div
            v-for="s in sessions"
            :key="s.id"
            :class="['session-item', { active: s.id === activeId }]"
            @click="activeId = s.id"
          >
            <el-icon class="session-icon"><ChatDotRound /></el-icon>
            <span class="session-title">{{ s.title }}</span>
            <el-icon v-if="sessions.length > 1" class="session-del" @click.stop="removeSession(s.id)">
              <Close />
            </el-icon>
          </div>
        </div>
      </div>

      <!-- 右侧对话区 -->
      <div class="chat-main">
        <div class="messages" ref="msgBox">
          <div v-if="activeSession.messages.length === 0" class="empty">
            <el-icon size="56" color="#dcdfe6"><ChatDotRound /></el-icon>
            <p class="empty-title">开始一段新对话</p>
            <p class="empty-hint">用默认 LLM Provider 直接聊，多轮上下文由前端维护</p>
          </div>

          <div
            v-for="(m, i) in activeSession.messages"
            :key="i"
            :class="['msg', `msg-${m.role}`]"
          >
            <div class="msg-avatar">
              <el-avatar :size="34" :style="{ background: m.role === 'user' ? '#409eff' : '#67c23a' }">
                {{ m.role === 'user' ? '我' : 'AI' }}
              </el-avatar>
            </div>
            <div class="msg-body">
              <div class="msg-bubble">
                <template v-for="(p, pi) in parseContent(m.content)" :key="pi">
                  <details v-if="p.type === 'think'" class="think-block">
                    <summary>
                      <el-icon><MagicStick /></el-icon>
                      <span>思考过程</span>
                      <span class="think-len">({{ p.content.length }} 字)</span>
                    </summary>
                    <pre class="think-content">{{ p.content }}</pre>
                  </details>
                  <div v-else class="msg-text">{{ p.content }}</div>
                </template>
                <span v-if="m.streaming" class="cursor-blink">▍</span>
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
              :disabled="streaming"
              placeholder="输入消息后按 Ctrl+Enter 发送"
              @keydown.ctrl.enter="send"
              @keydown.meta.enter="send"
            />
            <div class="input-actions">
              <el-tag v-if="error" type="danger" size="small">{{ error }}</el-tag>
              <span v-if="streaming" class="streaming-hint">
                <el-icon class="rotating"><Loading /></el-icon>
                正在生成…
              </span>
              <el-button v-if="streaming" type="warning" @click="abort" plain>停止</el-button>
              <el-button v-else type="primary" @click="send" :disabled="!input.trim()">发送</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue';
import { Plus, Close, ChatDotRound, MagicStick, Loading } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { chatStream } from '@/api/chat';

let sid = 0;
function createSession() {
  return { id: `s${++sid}`, title: '新对话', messages: [] };
}

const sessions = ref([createSession()]);
const activeId = ref(sessions.value[0].id);
const input = ref('');
const streaming = ref(false);
const error = ref(null);
const msgBox = ref(null);
let controller = null;

const activeSession = computed(
  () => sessions.value.find((s) => s.id === activeId.value) || sessions.value[0],
);

function newSession() {
  const s = createSession();
  sessions.value.unshift(s);
  activeId.value = s.id;
  input.value = '';
}

function removeSession(id) {
  if (sessions.value.length === 1) {
    ElMessage.warning('至少保留一个对话');
    return;
  }
  sessions.value = sessions.value.filter((s) => s.id !== id);
  if (activeId.value === id) activeId.value = sessions.value[0].id;
}

/* 解析 <think>...</think> 块 */
const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;
function parseContent(raw) {
  if (!raw) return [{ type: 'text', content: '' }];
  const parts = [];
  let lastIdx = 0;
  let m;
  THINK_REGEX.lastIndex = 0;
  while ((m = THINK_REGEX.exec(raw)) !== null) {
    if (m.index > lastIdx) parts.push({ type: 'text', content: raw.slice(lastIdx, m.index) });
    const t = m[1].trim();
    if (t) parts.push({ type: 'think', content: t });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < raw.length) parts.push({ type: 'text', content: raw.slice(lastIdx) });
  return parts.length ? parts : [{ type: 'text', content: raw }];
}

function send() {
  const text = input.value.trim();
  if (!text || streaming.value) return;

  const session = activeSession.value;
  if (session.messages.length === 0) session.title = text.slice(0, 20);
  session.messages.push({ role: 'user', content: text });
  session.messages.push({ role: 'assistant', content: '', streaming: true });
  const aiIdx = session.messages.length - 1;
  const history = session.messages
    .slice(0, -1)
    .map((m) => ({ role: m.role, content: m.content }));

  input.value = '';
  streaming.value = true;
  error.value = null;
  nextTick(scrollToBottom);

  controller = chatStream(text, history, {
    onDelta: (d) => {
      session.messages[aiIdx].content += d;
      nextTick(scrollToBottom);
    },
    onDone: () => {
      session.messages[aiIdx].streaming = false;
      streaming.value = false;
      controller = null;
    },
    onError: (msg) => {
      session.messages[aiIdx].content += `\n\n[错误] ${msg}`;
      session.messages[aiIdx].streaming = false;
      streaming.value = false;
      controller = null;
      error.value = msg;
    },
  });
}

function abort() {
  controller?.abort();
  controller = null;
  streaming.value = false;
  const last = activeSession.value.messages.at(-1);
  if (last?.streaming) last.streaming = false;
}

function scrollToBottom() {
  const el = msgBox.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(activeId, () => nextTick(scrollToBottom));
</script>

<style scoped>
.chat-page {
  height: calc(100vh - var(--topbar-height) - 2 * var(--content-padding));
}
.chat-shell {
  display: flex;
  height: 100%;
  background: #fff;
  border-radius: var(--radius-md);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}
.chat-side {
  width: 240px;
  border-right: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #fafbfc;
}
.side-header {
  padding: 12px;
  border-bottom: 1px solid #ebeef5;
}
.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background 0.15s;
}
.session-item:hover { background: #eef2f7; }
.session-item.active { background: #e6f0ff; color: #1890ff; }
.session-icon { flex-shrink: 0; }
.session-title {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-del { flex-shrink: 0; color: #c0c4cc; }
.session-del:hover { color: #f56c6c; }

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.messages {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  background: #fafbfc;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.empty {
  text-align: center;
  padding: 80px 0;
  color: #c0c4cc;
}
.empty-title { font-size: 16px; margin: 16px 0 4px; color: #606266; }
.empty-hint { font-size: 12px; color: #909399; margin: 0; }

.msg { display: flex; gap: 12px; align-items: flex-start; }
.msg-user { flex-direction: row-reverse; }
.msg-avatar { flex-shrink: 0; }
.msg-body { max-width: var(--chat-max-width); min-width: 0; }
.msg-user .msg-body { display: flex; flex-direction: column; align-items: flex-end; }

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
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
  color: #fff;
  border-top-right-radius: 2px;
}
.msg-assistant .msg-bubble {
  background: #fff;
  color: #303133;
  border: 1px solid #ebeef5;
  border-top-left-radius: 2px;
}
.msg-text { margin: 0; }
.msg-text + .msg-text { margin-top: 8px; }

.think-block {
  background: #f5f7fa;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 8px;
  font-size: 12px;
  color: #909399;
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
.think-len { color: #c0c4cc; font-size: 11px; }
.think-content {
  margin: 8px 0 0;
  padding: 8px;
  background: #fff;
  border-radius: 4px;
  font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #606266;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow-y: auto;
}

.cursor-blink {
  display: inline-block;
  color: #409eff;
  animation: blink 1s steps(2) infinite;
  margin-left: 2px;
}
@keyframes blink { 50% { opacity: 0; } }

.input-area {
  padding: 12px 24px;
  border-top: 1px solid #ebeef5;
  background: #fff;
}
.input-inner {
  max-width: 900px;
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
  color: #67c23a;
  margin-right: auto;
}
.rotating { animation: rot 1.2s linear infinite; }
@keyframes rot { to { transform: rotate(360deg); } }
</style>
