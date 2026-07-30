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
            <span
              class="mode-dot"
              :class="s.workflowId ? 'dot-wf' : s.agentId ? 'dot-agent' : s.kbIds?.length ? 'dot-kb' : 'dot-llm'"
              :title="s.workflowId ? '工作流对话' : s.agentId ? '智能体对话' : s.kbIds?.length ? '知识库问答' : '纯 LLM 对话'"
            ></span>
            <span class="session-title">{{ s.title || '新对话' }}</span>
            <el-icon class="session-del" @click.stop="removeSession(s)">
              <Close />
            </el-icon>
          </div>
        </div>
      </div>

      <!-- 右侧对话区 -->
      <div class="chat-main">
        <!-- 模式工具栏：显示当前是「纯 LLM」还是「工作流：xxx」，可一键切换 -->
        <div class="chat-toolbar">
          <div
            class="mode-pill"
            :class="{
              'mode-pill-wf': activeSession?.workflowId,
              'mode-pill-agent': activeSession?.agentId,
              'mode-pill-kb': !activeSession?.workflowId && !activeSession?.agentId && activeSession?.kbIds?.length,
            }"
          >
            <el-icon v-if="activeSession?.workflowId"><Connection /></el-icon>
            <el-icon v-else-if="activeSession?.agentId"><MagicStick /></el-icon>
            <el-icon v-else-if="activeSession?.kbIds?.length"><Collection /></el-icon>
            <el-icon v-else><ChatDotRound /></el-icon>
            <span v-if="activeSession?.workflowId">工作流：{{ workflowName(activeSession.workflowId) }}</span>
            <span v-else-if="activeSession?.agentId">智能体：{{ agentName(activeSession.agentId) }}</span>
            <span v-else-if="activeSession?.kbIds?.length">知识库问答</span>
            <span v-else>纯 LLM 对话</span>
          </div>

          <!-- 知识库 chips：显示当前会话已关联的 KB，点击删除 -->
          <div class="kb-chips" v-if="activeSession && !activeSession.workflowId && !activeSession.agentId">
            <el-tag
              v-for="id in (activeSession.kbIds || [])"
              :key="id"
              type="warning"
              size="small"
              closable
              @close="removeKb(id)"
              :title="kbName(id)"
            >
              <el-icon><Collection /></el-icon>
              <span style="margin-left: 4px">{{ kbName(id) }}</span>
            </el-tag>
            <el-button
              v-if="!activeSession.kbIds?.length"
              text
              :icon="Collection"
              size="small"
              @click="openKbPicker"
            >
              关联知识库
            </el-button>
            <el-button
              v-else
              text
              :icon="Plus"
              size="small"
              @click="openKbPicker"
            >
              管理
            </el-button>
          </div>

          <el-button text :icon="Switch" @click="openWorkflowPicker" size="small">
            切换模式
          </el-button>
        </div>
        <div
          class="messages"
          ref="msgBox"
          @dragover.prevent="onDragOver"
          @drop.prevent="onDrop"
        >
          <div v-if="!activeSession || !(activeSession.messages?.length)" class="empty">
            <el-icon size="56" color="#dcdfe6"><ChatDotRound /></el-icon>
            <p class="empty-title">开始一段新对话</p>
            <p class="empty-hint">用默认模型提供商直接聊，支持 Markdown 与文件上传</p>
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
                <!-- 检索来源：KB 命中片段（可展开） -->
                <div
                  v-if="m.sources && m.sources.length"
                  class="sources-panel"
                >
                  <div class="sources-header" @click="m.sourcesOpen = !m.sourcesOpen">
                    <el-icon><Collection /></el-icon>
                    <span>参考 {{ m.sources.length }} 段资料</span>
                    <el-icon class="sources-caret" :class="{ open: m.sourcesOpen }"><CaretBottom /></el-icon>
                  </div>
                  <div v-if="m.sourcesOpen" class="sources-body">
                    <div
                      v-for="(s, si) in m.sources"
                      :key="si"
                      class="source-item"
                    >
                      <div class="source-meta">
                        <el-tag size="small" type="info">{{ s.kbName || s.kbId }}</el-tag>
                        <span class="source-doc">{{ s.documentName || s.documentId || '未知文档' }}<span v-if="s.chunkIndex != null"> · 第 {{ s.chunkIndex + 1 }} 段</span></span>
                        <span class="source-score">RRF {{ (s.score ?? 0).toFixed(4) }}</span>
                      </div>
                      <div class="source-content">{{ s.content }}</div>
                    </div>
                  </div>
                </div>
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

    <!-- 工作流选择器：可切换"纯 LLM"或某个已发布工作流 -->
    <el-dialog
      v-model="wfPickerOpen"
      title="切换对话模式"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-radio-group v-model="wfPickerMode" class="wf-picker-mode">
        <el-radio-button value="llm">纯 LLM 对话</el-radio-button>
        <el-radio-button value="agent">智能体对话</el-radio-button>
        <el-radio-button value="workflow">工作流对话</el-radio-button>
      </el-radio-group>
      <div v-if="wfPickerMode === 'workflow'" class="wf-picker-list">
        <el-select
          v-model="wfPickerSelected"
          placeholder="选择已发布工作流"
          style="width: 100%"
          filterable
          :loading="wfPickerLoading"
        >
          <el-option
            v-for="w in publishedWorkflows"
            :key="w.id"
            :label="w.name"
            :value="w.id"
          >
            <span style="float:left">{{ w.name }}</span>
            <span style="float:right;color:#999;font-size:12px">v{{ w.version }}</span>
          </el-option>
        </el-select>
        <p class="wf-picker-hint">仅显示「已发布」工作流。每个会话独立绑定一个工作流，新建对话会重置绑定。</p>
      </div>
      <div v-else-if="wfPickerMode === 'agent'" class="wf-picker-list">
        <el-select
          v-model="agentPickerSelected"
          placeholder="选择已发布智能体"
          style="width: 100%"
          filterable
          :loading="wfPickerLoading"
        >
          <el-option
            v-for="a in publishedAgents"
            :key="a.id"
            :label="a.name"
            :value="a.id"
          >
            <span style="float:left">{{ a.name }}</span>
            <span style="float:right;color:#999;font-size:12px">{{ a.description || '' }}</span>
          </el-option>
        </el-select>
        <p class="wf-picker-hint">仅显示「已发布」智能体。智能体自带角色设定（系统提示词 + 模型配置），支持多轮上下文；暂不支持附件上传。</p>
      </div>
      <p v-else class="wf-picker-hint">纯 LLM 模式：直接用默认 Provider 聊天，无工作流编排。</p>
      <template #footer>
        <el-button @click="wfPickerOpen = false">取消</el-button>
        <el-button
          type="primary"
          :disabled="(wfPickerMode === 'workflow' && !wfPickerSelected) || (wfPickerMode === 'agent' && !agentPickerSelected)"
          @click="confirmWorkflowPicker"
        >确定</el-button>
      </template>
    </el-dialog>

    <!-- 知识库选择器：多选，给当前会话关联 KB -->
    <el-dialog
      v-model="kbPickerOpen"
      title="关联知识库"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-select
        v-model="kbPickerSelected"
        multiple
        filterable
        placeholder="选择要检索的知识库"
        style="width: 100%"
      >
        <el-option
          v-for="k in availableKbs"
          :key="k.id"
          :label="k.name"
          :value="k.id"
        />
      </el-select>
      <p class="wf-picker-hint">
        每个消息都会对所选知识库做混合检索（向量+BM25+RRF），命中片段会作为 system prompt 喂给 LLM，
        并在回复下显示「参考 N 段资料」面板。仅「纯 LLM 对话」生效（智能体/工作流模式按各自的 KB 节点/工作流图配置）。
      </p>
      <p class="wf-picker-hint" v-if="availableKbs.length === 0">尚未配置任何知识库，请先在「知识库」页创建。</p>
      <template #footer>
        <el-button @click="kbPickerOpen = false">取消</el-button>
        <el-button type="primary" @click="confirmKbPicker">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted } from 'vue';
import {
  Plus, Close, ChatDotRound, MagicStick, UploadFilled, Document, VideoPause,
  Switch, Connection, Collection, CaretBottom,
} from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  chatStream,
  listConversations,
  getConversationMessages,
  deleteConversation,
} from '@/api/chat';
import { listWorkflows } from '@/api/workflows';
import { listAgents, chatStream as agentChatStream } from '@/api/agent';
import { listKnowledgeBases } from '@/api/knowledge-bases';
import ThinkingBlock from '@/components/chat/ThinkingBlock.vue';
import MarkdownView from '@/components/chat/MarkdownView.vue';

let localCounter = 0;
function makeLocalSession() {
  return {
    id: null,
    localId: `local-${++localCounter}`,
    title: '新对话',
    messages: [],
    workflowId: null, // 绑工作流：非空时 send 会走工作流引擎
    agentId: null, // 绑智能体：非空时 send 会走 /api/agents/{id}/chat
    kbIds: [], // 关联知识库：非空时后端会自动做混合检索并把命中片段喂给 LLM
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
// ===== 工作流/智能体模式相关状态 =====
const publishedWorkflows = ref([]); // 仅"已发布"工作流
const workflowNames = ref({}); // id -> name（用于顶栏展示）
const publishedAgents = ref([]); // 仅"已发布"chat 智能体
const agentNames = ref({}); // id -> name（用于顶栏展示）
const wfPickerOpen = ref(false);
const wfPickerMode = ref('llm'); // 'llm' | 'agent' | 'workflow'
const wfPickerSelected = ref('');
const agentPickerSelected = ref('');
const wfPickerLoading = ref(false);
let controller = null;
let typingTimer = null;
// ===== 知识库选择器状态（per-session）=====
const availableKbs = ref([]); // 全组织可用的 KB 列表（懒加载一次）
let kbsLoaded = false;
const kbPickerOpen = ref(false);
const kbPickerSelected = ref([]); // el-select 多选 v-model
async function loadKbsIfNeeded() {
  if (kbsLoaded) return;
  try {
    const list = await listKnowledgeBases();
    availableKbs.value = (list || []).filter((k) => k.status !== 'archived');
    kbsLoaded = true;
  } catch (e) {
    ElMessage.error('加载知识库列表失败：' + (e?.message || e));
  }
}

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
      lastMessageAt: c.lastMessageAt || null,
      createdAt: c.createdAt || null,
      workflowId: c.workflowId || null, // 工作流模式对话的标记
      agentId: c.agentId || null, // 智能体模式对话的标记
      kbIds: Array.isArray(c.kbIds) ? c.kbIds : [], // 兼容旧接口/历史数据，模板永远拿到数组
    })).sort((a, b) => {
      // 前端再做一次防御性排序：即使旧后端把 NULL lastMessageAt 放在最前，也按最近活动时间排列。
      const aTime = Date.parse(a.lastMessageAt || a.createdAt || 0) || 0;
      const bTime = Date.parse(b.lastMessageAt || b.createdAt || 0) || 0;
      return bTime - aTime;
    });
    // 历史会话里有智能体/知识库对话时，懒加载名字（用于顶栏与 chips 展示）
    if (fresh.some((c) => c.agentId)) ensureAgentNames();
    if (fresh.some((c) => c.kbIds.length)) loadKbsIfNeeded();
    // 保留当前激活会话的内存 messages，避免 loadSessions 把还在流式打字的消息"刷掉"。
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
  // 历史接口/旧数据缺字段时先规范化，避免模板读取 undefined.length 让整个组件崩溃。
  if (!Array.isArray(s.messages)) s.messages = [];
  if (!Array.isArray(s.kbIds)) s.kbIds = [];
  activeKey.value = key;
  if (s.id && s.messages.length === 0) {
    await loadMessages(s.id);
  }
}

function promoteSession(s, at = new Date().toISOString()) {
  if (!s) return;
  s.lastMessageAt = at;
  const index = sessions.value.indexOf(s);
  if (index > 0) {
    sessions.value.splice(index, 1);
    sessions.value.unshift(s);
  }
}

function newSession() {
  const s = makeLocalSession();
  sessions.value.unshift(s);
  activeKey.value = s.localId;
  input.value = '';
  attachedFiles.value = [];
  // 切到新对话：默认"纯 LLM"模式；如需智能体/工作流模式再点切换
  s.workflowId = null;
  s.agentId = null;
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

  // 智能体模式暂不支持附件（后端 ChatDto 只收 message/conversationId）
  if (session.agentId && attachedFiles.value.length > 0) {
    ElMessage.warning('智能体模式暂不支持附件，请先移除附件或切换到纯 LLM 模式');
    return;
  }

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
    sources: [], // KB 检索来源（首个 delta 之前由 onSources 注入）
    sourcesOpen: false, // 是否展开来源面板
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

  // 三种模式共用同一套 SSE 回调（打字机 / thinking / 会话升级逻辑完全一致）
  const sseCallbacks = {
      onConversationId: (cid) => {
        if (!session.id) {
          // 不调 loadSessions()：只把当前本地对象升级为持久会话，保留流式 messages。
          session.id = cid;
          session.localId = cid;
          activeKey.value = cid;
        }
        if (!Array.isArray(session.kbIds)) session.kbIds = [];
        if (!sessions.value.includes(session)) sessions.value.unshift(session);
        // 新建或继续发送都立即移到列表首位，不等流结束后重拉整个列表。
        promoteSession(session);
      },
      onSources: (items) => {
        // KB 检索来源（首个 delta 之前注入），覆盖默认 []。
        // 注意：sources 一旦挂上就跟着 aiMsg 走，重发（abort+resend）也不会残留
        aiMsg.sources = Array.isArray(items) ? items : [];
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
        // 局部更新并移到首位，不重拉整个会话列表（避免流式结束后界面闪烁/消息丢失）。
        promoteSession(session);
      },
      onError: (msg) => {
        aiMsg.content += `\n\n[错误] ${msg}`;
        aiMsg.phase = 'done';
        aiMsg.display = aiMsg.content;
        stopTyper();
        streaming.value = false;
        stopTypingTimer();
        controller = null;
        promoteSession(session);
        error.value = msg;
      },
  };

  if (session.agentId) {
    // 智能体模式：走 /api/agents/{id}/chat（后端按 agent 的 systemPrompt + modelConfig 调 LLM，多轮上下文）
    controller = agentChatStream(
      session.agentId,
      { message: text, conversationId: conversationId || undefined },
      sseCallbacks,
    );
  } else {
    // 纯 LLM / 工作流模式：走 /api/chat
    controller = chatStream(
      text,
      conversationId,
      sseCallbacks,
      filePayload,
      session.workflowId || '', // 工作流模式：把当前会话绑定的 workflowId 传后端
      session.workflowId ? [] : (session.kbIds || []), // 工作流模式 KB 由图本身管；纯 LLM 用会话的 kbIds
    );
  }
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

/* ===== 模式切换（纯 LLM / 智能体 / 工作流） ===== */
function workflowName(id) {
  return workflowNames.value[id] || id;
}
function agentName(id) {
  return agentNames.value[id] || id;
}

// 懒加载智能体列表并建 id->name 索引（顶栏 pill 与选择器共用）
let agentNamesLoaded = false;
async function ensureAgentNames() {
  if (agentNamesLoaded) return;
  agentNamesLoaded = true;
  try {
    const list = await listAgents();
    const published = (list || []).filter(
      (a) => a.status === 'published' && (!a.type || a.type === 'chat'),
    );
    publishedAgents.value = published;
    // 名字索引对所有 agent 建（历史会话可能绑了已下架的 agent，也要能显示名字）
    for (const a of list || []) agentNames.value[a.id] = a.name;
  } catch (e) {
    agentNamesLoaded = false; // 失败允许重试
    ElMessage.error('加载智能体列表失败：' + (e?.message || e));
  }
}

async function openWorkflowPicker() {
  // 打开弹窗：并行拉工作流 + 智能体列表（各自只拉一次）
  wfPickerLoading.value = true;
  try {
    const tasks = [ensureAgentNames()];
    if (publishedWorkflows.value.length === 0) {
      tasks.push(
        listWorkflows().then((list) => {
          const published = (list || []).filter((w) => w.status === 'published');
          publishedWorkflows.value = published;
          for (const w of published) workflowNames.value[w.id] = w.name;
        }),
      );
    }
    await Promise.all(tasks);
  } catch (e) {
    ElMessage.error('加载列表失败：' + (e?.message || e));
  } finally {
    wfPickerLoading.value = false;
  }
  // 预填当前选择
  const s = activeSession.value;
  if (s?.workflowId) {
    wfPickerMode.value = 'workflow';
    wfPickerSelected.value = s.workflowId;
  } else if (s?.agentId) {
    wfPickerMode.value = 'agent';
    agentPickerSelected.value = s.agentId;
  } else {
    wfPickerMode.value = 'llm';
    wfPickerSelected.value = '';
    agentPickerSelected.value = '';
  }
  wfPickerOpen.value = true;
}

async function confirmWorkflowPicker() {
  const session = activeSession.value;
  if (!session) return;
  // 流式期间禁止切换（会丢消息）
  if (streaming.value) {
    ElMessage.warning('生成中无法切换，请先停止');
    return;
  }
  const targetWfId = wfPickerMode.value === 'workflow' ? wfPickerSelected.value : null;
  const targetAgentId = wfPickerMode.value === 'agent' ? agentPickerSelected.value : null;
  // 切换模式视为"开新对话"：清空当前 messages（避免跨模式串味）
  if (session.workflowId !== targetWfId || session.agentId !== targetAgentId) {
    session.workflowId = targetWfId;
    session.agentId = targetAgentId;
    session.messages = []; // 清空消息
    session.id = null; // 标记为新会话（让后端创建新的 conversation）
    session.localId = session.localId.includes('local-') ? session.localId : `local-${++localCounter}`;
    activeKey.value = session.localId;
    // 调整会话标题
    if (targetWfId) {
      session.title = `工作流：${workflowName(targetWfId)}`;
    } else if (targetAgentId) {
      session.title = `智能体：${agentName(targetAgentId)}`;
    } else {
      session.title = '新对话';
    }
    input.value = '';
    attachedFiles.value = [];
  }
  wfPickerOpen.value = false;
}

onMounted(() => {
  loadSessions();
});

/* ===== 知识库选择器 ===== */
function kbName(id) {
  const k = availableKbs.value.find((x) => x.id === id);
  return k ? k.name : id;
}
function openKbPicker() {
  loadKbsIfNeeded();
  const s = activeSession.value;
  kbPickerSelected.value = s?.kbIds ? [...s.kbIds] : [];
  kbPickerOpen.value = true;
}
function confirmKbPicker() {
  const s = activeSession.value;
  if (s) s.kbIds = [...kbPickerSelected.value];
  kbPickerOpen.value = false;
}
function removeKb(id) {
  const s = activeSession.value;
  if (!s) return;
  s.kbIds = (s.kbIds || []).filter((x) => x !== id);
}
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
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafbfc;
}
.mode-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 13px;
  font-weight: 500;
}
.mode-pill.mode-pill-wf {
  background: #f0f9eb;
  color: #67c23a;
}
.mode-pill.mode-pill-agent {
  background: #f5f0ff;
  color: #722ed1;
}
.mode-pill.mode-pill-kb {
  background: #fdf6ec;
  color: #e6a23c;
}
/* 会话列表四色模式点：与顶栏 pill 颜色保持一致（蓝=纯 LLM，橙=知识库，紫=智能体，绿=工作流） */
.mode-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
}
.dot-llm { background: #409eff; }   /* 蓝=纯 LLM（与 .mode-pill 默认色 #409eff 对齐） */
.dot-kb { background: #e6a23c; }    /* 橙=知识库 */
.dot-agent { background: #722ed1; } /* 紫=智能体 */
.dot-wf { background: #67c23a; }    /* 绿=工作流（与 .mode-pill.mode-pill-wf 色 #67c23a 对齐） */
.wf-picker-mode {
  display: flex;
  margin-bottom: 16px;
  width: 100%;
}
.wf-picker-mode :deep(.el-radio-button__inner) {
  width: 100%;
}
.wf-picker-list {
  margin-top: 4px;
}
.wf-picker-hint {
  margin-top: 12px;
  font-size: 12px;
  color: #999;
  line-height: 1.6;
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

/* ===== 工具栏 KB chips ===== */
.kb-chips {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* ===== 助手消息：检索来源面板 ===== */
.sources-panel {
  margin-top: 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafbfc;
  font-size: 12px;
  overflow: hidden;
}
.sources-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  color: #606266;
  user-select: none;
}
.sources-header:hover { background: #f0f3f7; }
.sources-caret { margin-left: auto; transition: transform 0.2s; }
.sources-caret.open { transform: rotate(180deg); }
.sources-body {
  border-top: 1px solid #ebeef5;
  max-height: 260px;
  overflow-y: auto;
  padding: 4px 0;
}
.source-item {
  padding: 6px 12px;
  border-bottom: 1px solid #f0f0f0;
}
.source-item:last-child { border-bottom: none; }
.source-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.source-doc { color: #303133; font-weight: 500; }
.source-score {
  margin-left: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #909399;
  font-size: 11px;
}
.source-content {
  color: #606266;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}
</style>
