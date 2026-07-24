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
        <div class="session-list" v-loading="loadingList">
          <div v-if="sessions.length === 0 && !loadingList" class="empty-side">
            <el-icon size="28" color="#dcdfe6"><ChatDotRound /></el-icon>
            <p>暂无对话</p>
          </div>
          <div
            v-for="s in sessions"
            :key="s.id || s.localId"
            :class="['session-item', { active: (s.id || s.localId) === activeKey }]"
            @click="switchSession(s)"
          >
            <el-icon class="session-icon"><ChatDotRound /></el-icon>
            <span class="session-title">{{ s.title || '新对话' }}</span>
            <el-icon class="session-del" @click.stop="removeSession(s)">
              <Close />
            </el-icon>
          </div>
        </div>
      </div>

      <!-- 右侧对话区 -->
      <div class="chat-main">
        <div
          class="messages"
          ref="msgBox"
          @dragover.prevent="onDragOver"
          @drop.prevent="onDrop"
        >
          <div v-if="!activeSession || activeSession.messages.length === 0" class="empty">
            <el-icon size="56" color="#dcdfe6"><ChatDotRound /></el-icon>
            <p class="empty-title">开始一段新对话</p>
            <p class="empty-hint">用默认 LLM Provider 直接聊，支持 Markdown 与文件上传</p>
          </div>

          <div
            v-for="(m, i) in (activeSession?.messages || [])"
            :key="i"
            :class="['msg', `msg-${m.role}`]"
          >
            <div class="msg-avatar">
              <el-avatar :size="34" :style="{ background: m.role === 'user' ? '#409eff' : '#67c23a' }">
                {{ m.role === 'user' ? '我' : 'AI' }}
              </el-avatar>
            </div>
            <div class="msg-body">
              <!-- 用户消息 -->
              <div v-if="m.role === 'user'" class="msg-bubble user-bubble">
                <div v-if="m.attachments && m.attachments.length" class="attach-list">
                  <div v-for="(a, ai) in m.attachments" :key="ai" class="attach-item">
                    <img v-if="a.type && a.type.startsWith('image/')" :src="a.url" class="attach-thumb" alt="">
                    <div v-else class="attach-file">
                      <el-icon><Document /></el-icon>
                      <span>{{ a.name || 'file' }}</span>
                    </div>
                  </div>
                </div>
                <div class="msg-text">{{ m.content }}</div>
              </div>

              <!-- 助手消息 -->
              <div v-else class="msg-bubble ai-bubble">
                <!-- 思考中：loading 占位（首个 delta 未到达） -->
                <div v-if="m.phase === 'thinking' && !m.content" class="thinking-loader">
                  <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                  <span class="thinking-text">
                    AI 正在思考<span v-if="(m.elapsed || 0) >= 1">（{{ m.elapsed }}s）</span>…
                  </span>
                </div>
                <template v-else>
                  <template v-for="(p, pi) in parseContent(displayedText(m))" :key="pi">
                    <ThinkingBlock
                      v-if="p.type === 'think'"
                      :content="p.content"
                      :streaming="m.phase === 'streaming'"
                    />
                    <MarkdownView
                      v-else
                      :content="p.content"
                      :streaming="m.phase === 'streaming' && pi === lastSegmentIdx(m)"
                    />
                  </template>
                </template>
                <div v-if="m.attachments && m.attachments.length" class="attach-list ai-attach">
                  <div v-for="(a, ai) in m.attachments" :key="ai" class="attach-item">
                    <img v-if="a.type && a.type.startsWith('image/')" :src="a.url" class="attach-thumb" alt="">
                    <div v-else class="attach-file">
                      <el-icon><Document /></el-icon>
                      <span>{{ a.name || 'file' }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="input-area">
          <!-- 附件预览 -->
          <div v-if="attachedFiles.length" class="attach-preview">
            <div v-for="(f, fi) in attachedFiles" :key="fi" class="attach-chip">
              <img v-if="f.url && f.type.startsWith('image/')" :src="f.url" class="chip-thumb" alt="">
              <el-icon v-else><Document /></el-icon>
              <span class="chip-name">{{ f.name }}</span>
              <el-icon class="chip-del" @click="removeAttachment(fi)"><Close /></el-icon>
            </div>
          </div>

          <div class="input-inner">
            <el-input
              v-model="input"
              type="textarea"
              :autosize="{ minRows: 2, maxRows: 8 }"
              :disabled="streaming"
              placeholder="输入消息，Enter 发送（Shift+Enter 换行），可拖拽或点击上传文件"
              @keydown.ctrl.enter="send"
              @keydown.meta.enter="send"
              @keydown.enter.exact.prevent="send"
            />
            <div class="input-actions">
              <el-button
                :icon="UploadFilled"
                circle
                plain
                :disabled="streaming"
                title="上传文件"
                @click="fileInput?.click()"
              />
              <input
                ref="fileInput"
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.doc,.docx,.csv,.json"
                class="hidden-file"
                @change="onFileChange"
              />
              <el-tag v-if="error" type="danger" size="small">{{ error }}</el-tag>
              <!-- 流式时：右侧改为停止图标按钮（圆形 plain + VideoPause 两个竖条，类 ChatGPT 方块停止） -->
              <el-button
                v-if="streaming"
                :icon="VideoPause"
                circle
                type="warning"
                plain
                title="停止生成"
                @click="abort"
              />
              <!-- 非流式时：发送按钮 -->
              <el-button v-else type="primary" @click="send" :disabled="!canSend">发送</el-button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import {
  Plus, Close, ChatDotRound, MagicStick, UploadFilled, Document, VideoPause,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  chatStream,
  listConversations,
  getConversationMessages,
  deleteConversation,
} from '@/api/chat';
import ThinkingBlock from '@/components/chat/ThinkingBlock.vue';
import MarkdownView from '@/components/chat/MarkdownView.vue';

let localCounter = 0;
function makeLocalSession() {
  return {
    id: null,
    localId: `local-${++localCounter}`,
    title: '新对话',
    messages: [],
  };
}

const sessions = ref([]);
const activeKey = ref(null);
const input = ref('');
const streaming = ref(false);
const error = ref(null);
const loadingList = ref(false);
const msgBox = ref(null);
const fileInput = ref(null);
const attachedFiles = ref([]);
let controller = null;
let typingTimer = null;

const activeSession = computed(
  () => sessions.value.find((s) => (s.id || s.localId) === activeKey.value),
);
const canSend = computed(
  () => !!input.value.trim() || attachedFiles.value.length > 0,
);

/* 解析 <think>...</think>（兼容流式未闭合的 <think> 残段） */
function parseContent(raw) {
  if (!raw) return [{ type: 'text', content: '' }];
  const parts = [];
  const RE = /<think>([\s\S]*?)<\/think>/g;
  let last = 0;
  let m;
  while ((m = RE.exec(raw)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: raw.slice(last, m.index) });
    parts.push({ type: 'think', content: m[1].trim() });
    last = m.index + m[0].length;
  }
  const rest = raw.slice(last);
  if (rest) {
    const openIdx = rest.indexOf('<think>');
    if (openIdx >= 0) {
      if (openIdx > 0) parts.push({ type: 'text', content: rest.slice(0, openIdx) });
      parts.push({ type: 'think', content: rest.slice(openIdx + 7).trim() });
    } else {
      parts.push({ type: 'text', content: rest });
    }
  }
  return parts.length ? parts : [{ type: 'text', content: raw }];
}

// 流式/打字过程中展示 display（未追平 content 时），追平后展示完整 content。
// 这样打字机 reveal 的是「已 reveal 出来的前缀」，而不是后端/代理分块后的整段。
function displayedText(m) {
  if (m.role !== 'assistant') return m.content;
  if (m.display != null && m.display.length < (m.content || '').length) return m.display;
  return m.content;
}

// 最后一个 text 段索引（用于 MarkdownView 在流式期间显示打字光标）
function lastSegmentIdx(m) {
  const parts = parseContent(displayedText(m));
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].type === 'text') return i;
  }
  return -1;
}

/* 打字机效果：把已经到达的完整文本按字符节奏逐步 reveal 到 display，
   与网络分块（代理可能把后端 1~3 字符的 token 合并成 20 字符的大块）完全解耦，
   保证无论后端/代理怎么分块，界面都平滑逐字出现。 */
let typerTimer = null;
function startTyper(msg) {
  stopTyper();
  const STEP = 2; // 每个 tick 揭示的字符数
  const INTERVAL = 20; // tick 间隔(ms)
  const tick = () => {
    const full = msg.content || '';
    const cur = msg.display || '';
    if (cur.length < full.length) {
      msg.display = full.slice(0, Math.min(full.length, cur.length + STEP));
      typerTimer = setTimeout(tick, INTERVAL);
    } else if (msg.phase !== 'done') {
      // 内容还没接收完（thinking / streaming 阶段，delta 尚未到达或本段已显示完），
      // 继续等待下一波 delta。
      // 注意：首帧 phase 是 'thinking'（delta 还没来），必须在这里继续 tick，
      // 否则会误入 else 清空定时器，导致 display 永远停在 ''（最终由 onDone 一次性显示 = 无打字机）。
      typerTimer = setTimeout(tick, INTERVAL);
    } else {
      msg.display = full;
      typerTimer = null;
    }
  };
  tick();
}
function stopTyper() {
  if (typerTimer) {
    clearTimeout(typerTimer);
    typerTimer = null;
  }
}

/* 加载会话列表 */
async function loadSessions() {
  loadingList.value = true;
  try {
    const list = await listConversations();
    const fresh = (list || []).map((c) => ({
      id: c.id,
      localId: c.id,
      title: c.title || '新对话',
      messages: [],
      lastMessageAt: c.lastMessageAt,
    }));
    // 保留当前激活会话的内存 messages，避免 loadSessions 把还在流式打字的消息“刷掉”。
    // 仅在首次进入页面（无激活会话）或列表为空时才强制切换 activeKey。
    const stillActive =
      activeKey.value && fresh.some((c) => c.id === activeKey.value);
    sessions.value = fresh;
    if (fresh.length === 0) {
      newSession();
    } else if (!stillActive && !activeKey.value) {
      activeKey.value = fresh[0].id;
      await loadMessages(fresh[0].id);
    }
  } catch (e) {
    ElMessage.error('加载会话列表失败：' + (e?.message || e));
    if (sessions.value.length === 0) {
      sessions.value = [makeLocalSession()];
      activeKey.value = sessions.value[0].localId;
    }
  } finally {
    loadingList.value = false;
  }
}

async function loadMessages(conversationId) {
  const s = sessions.value.find((x) => x.id === conversationId);
  if (!s) return;
  try {
    const msgs = await getConversationMessages(conversationId);
    s.messages = (msgs || []).map((msg) => ({
      role: msg.role,
      content: msg.content,
      phase: 'done',
      attachments: normalizeAttachments(msg.attachments),
      elapsed: 0,
    }));
    nextTick(scrollToBottom);
  } catch (e) {
    ElMessage.error('加载历史消息失败：' + (e?.message || e));
  }
}

// 后端 attachments 可能是 JSON 字符串或数组
function normalizeAttachments(a) {
  if (!a) return [];
  let arr = a;
  if (typeof a === 'string') {
    try { arr = JSON.parse(a); } catch { return []; }
  }
  return Array.isArray(arr) ? arr : [];
}

async function switchSession(s) {
  const key = s.id || s.localId;
  if (key === activeKey.value) return;
  activeKey.value = key;
  if (s.id && s.messages.length === 0) {
    await loadMessages(s.id);
  }
}

function newSession() {
  const s = makeLocalSession();
  sessions.value.unshift(s);
  activeKey.value = s.localId;
  input.value = '';
  attachedFiles.value = [];
}

async function removeSession(s) {
  const key = s.id || s.localId;
  try {
    if (s.id) {
      await ElMessageBox.confirm('确定删除该对话及其所有消息？', '删除确认', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      });
      await deleteConversation(s.id);
    }
  } catch (e) {
    if (e === 'cancel' || e?.message === 'cancel') return;
    ElMessage.error('删除失败：' + (e?.message || e));
    return;
  }
  sessions.value = sessions.value.filter((x) => (x.id || x.localId) !== key);
  if (activeKey.value === key) {
    if (sessions.value.length === 0) {
      newSession();
    } else {
      activeKey.value = sessions.value[0].id || sessions.value[0].localId;
      const ns = sessions.value[0];
      if (ns.id && ns.messages.length === 0) await loadMessages(ns.id);
    }
  }
}

/* ---- 文件上传 ---- */
function onFileChange(e) {
  const files = Array.from(e.target.files || []);
  addFiles(files);
  e.target.value = '';
}
function onDragOver() {}
function onDrop(e) {
  const files = Array.from(e.dataTransfer?.files || []);
  if (files.length) addFiles(files);
}
function addFiles(files) {
  for (const f of files) {
    if (attachedFiles.value.length >= 10) {
      ElMessage.warning('最多上传 10 个文件');
      break;
    }
    attachedFiles.value.push({
      file: f,
      name: f.name,
      type: f.type,
      size: f.size,
      url: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
    });
  }
}
function removeAttachment(idx) {
  const f = attachedFiles.value[idx];
  if (f?.url) URL.revokeObjectURL(f.url);
  attachedFiles.value.splice(idx, 1);
}

/* ---- 发送 ---- */
function send() {
  const text = input.value.trim();
  if (!text || streaming.value) return;
  if (!canSend.value) return;

  const session = activeSession.value;
  if (!session) return;

  // 把附件整理成可显示结构（发送前先存本地展示用）
  const pendingAttachments = attachedFiles.value.map((f) => ({
    name: f.name,
    type: f.type,
    url: f.url,
    local: true,
  }));

  if (session.messages.length === 0) session.title = text.slice(0, 20);
  session.messages.push({ role: 'user', content: text, attachments: pendingAttachments });
  // 注意：必须用 reactive 包裹，否则闭包里持有的是「裸对象」，
  // aiMsg.content += d 会绕过 Vue 的响应式代理 → 流式期间不触发重渲染，
  // 内容只能等 onDone 时 loadSessions() 整体替换数组才一次性出现（即“一下子全出来”）。
  const aiMsg = reactive({
    role: 'assistant',
    content: '',
    display: '', // 打字机：当前已 reveal 出来的文本（<= content）
    phase: 'thinking',
    elapsed: 0,
    attachments: [],
  });
  session.messages.push(aiMsg);
  startTyper(aiMsg); // 启动打字机：随 deltas 到达逐字 reveal
  const conversationId = session.id;

  // 提取待上传的文件对象（必须在清空 attachedFiles 之前）
  const filePayload = pendingAttachments.length
    ? attachedFiles.value.map((f) => f.file)
    : [];

  input.value = '';
  attachedFiles.value = [];
  streaming.value = true;
  error.value = null;
  nextTick(scrollToBottom);

  startTypingTimer(aiMsg);

  controller = chatStream(
    text,
    conversationId,
    {
      onConversationId: (cid) => {
        if (!session.id) {
          // 不调 loadSessions() —— 后端给的 cid 就是当前会话的后端 id，
          // 只需把本地会话升级为持久会话，保留正在流式 reveal 的 messages（避免被整个替换后“丢消息”）。
          session.id = cid;
          session.localId = cid;
          activeKey.value = cid;
          // 侧边栏补一条：把这条新会话加到列表头（如果还没有）
          const exists = sessions.value.some((x) => x.id === cid);
          if (!exists) {
            const stub = {
              id: cid,
              localId: cid,
              title: session.title || '新对话',
              messages: session.messages,
              lastMessageAt: new Date().toISOString(),
            };
            sessions.value.unshift(stub);
          }
        }
      },
      onThinking: () => {
        // keepalive 心跳：保持 thinking 状态
      },
      onDelta: (d) => {
        aiMsg.content += d;
        if (aiMsg.phase === 'thinking') {
          aiMsg.phase = 'streaming';
        }
        nextTick(scrollToBottom);
      },
      onDone: () => {
        aiMsg.phase = 'done';
        aiMsg.display = aiMsg.content; // 追平，打字机结束
        stopTyper();
        streaming.value = false;
        stopTypingTimer();
        controller = null;
        // 只更新侧边栏对应会话的 lastMessageAt，不重拉整个会话列表（避免流式结束后“界面刷新”）
        const s = sessions.value.find((x) => (x.id || x.localId) === conversationId);
        if (s) s.lastMessageAt = new Date().toISOString();
        // 持久化会话可能还没把 localId 升级为后端 id（极端时序），确保侧边栏可定位
        if (session.id !== conversationId && conversationId) {
          session.id = conversationId;
          session.localId = conversationId;
          activeKey.value = conversationId;
        }
      },
      onError: (msg) => {
        aiMsg.content += `\n\n[错误] ${msg}`;
        aiMsg.phase = 'done';
        aiMsg.display = aiMsg.content;
        stopTyper();
        streaming.value = false;
        stopTypingTimer();
        controller = null;
        error.value = msg;
      },
    },
    filePayload,
  );
}

function startTypingTimer(aiMsg) {
  stopTypingTimer();
  aiMsg.elapsed = 0;
  typingTimer = setInterval(() => {
    aiMsg.elapsed = (aiMsg.elapsed || 0) + 1;
  }, 1000);
}
function stopTypingTimer() {
  if (typingTimer) {
    clearInterval(typingTimer);
    typingTimer = null;
  }
}

function abort() {
  controller?.abort();
  controller = null;
  streaming.value = false;
  stopTypingTimer();
  stopTyper();
  const session = activeSession.value;
  if (!session) return;
  const last = session.messages.at(-1);
  if (last?.phase === 'thinking' || last?.phase === 'streaming') {
    last.phase = 'done';
    if (!last.content) last.content = '_（已停止生成）_';
    last.display = last.content;
  }
}

function scrollToBottom() {
  const el = msgBox.value;
  if (el) el.scrollTop = el.scrollHeight;
}

onMounted(() => {
  loadSessions();
});
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
.empty-side {
  text-align: center;
  padding: 30px 0;
  color: #c0c4cc;
  font-size: 13px;
}
.empty-side p { margin: 6px 0 0; }
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
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.user-bubble {
  background: linear-gradient(135deg, #409eff 0%, #66b1ff 100%);
  color: #fff;
  border-top-right-radius: 2px;
}
.ai-bubble {
  background: #fff;
  color: #303133;
  border: 1px solid #ebeef5;
  border-top-left-radius: 2px;
  width: 100%;
}
.msg-text { margin: 0; white-space: pre-wrap; }

/* 附件 */
.attach-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.attach-item .attach-thumb {
  max-width: 160px;
  max-height: 160px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,.4);
}
.ai-bubble .attach-item .attach-thumb { border-color: #ebeef5; }
.attach-file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  background: rgba(255,255,255,.18);
  padding: 4px 8px;
  border-radius: 6px;
  max-width: 200px;
}
.ai-bubble .attach-file { background: #f5f7fa; color: #606266; }

/* thinking loader: 三球 loading + 文字 */
.thinking-loader {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 13px;
}
.thinking-loader .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #67c23a;
  display: inline-block;
  animation: bounce 1.4s infinite ease-in-out both;
}
.thinking-loader .dot:nth-child(1) { animation-delay: 0s; }
.thinking-loader .dot:nth-child(2) { animation-delay: 0.16s; }
.thinking-loader .dot:nth-child(3) { animation-delay: 0.32s; }
.thinking-loader .thinking-text { margin-left: 2px; }
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.5); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* 附件预览 chips */
.attach-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12px;
  color: #606266;
  max-width: 200px;
}
.chip-thumb {
  width: 28px; height: 28px;
  object-fit: cover;
  border-radius: 4px;
}
.chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}
.chip-del { cursor: pointer; color: #c0c4cc; }
.chip-del:hover { color: #f56c6c; }

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
.hidden-file { display: none; }
</style>
