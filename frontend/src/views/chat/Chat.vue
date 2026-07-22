<template>
  <div class="chat-page">
    <h2 class="page-title">聊天调试（Chat Agent）</h2>
    <el-card shadow="never">
      <el-empty v-if="!providers.length" description="还没有可用 LLM Provider">
        <template #extra>
          <el-alert type="info" :closable="false" show-icon>
            <p style="margin: 0">本功能需要先在 <b>系统管理 → LLM Provider</b> 中配置 Provider</p>
            <p style="margin: 8px 0 0">当前 Phase 1 MVP 尚未提供 Provider 管理界面，仅展示基础调试页结构</p>
          </el-alert>
        </template>
      </el-empty>

      <div v-else class="chat-shell">
        <el-aside width="220px" class="chat-side">
          <div class="side-title">会话</div>
          <el-menu :default-active="active" @select="onSelect">
            <el-menu-item index="new">+ 新建会话</el-menu-item>
          </el-menu>
        </el-aside>
        <el-main class="chat-main">
          <div class="messages" ref="msgBox">
            <div v-for="(m, i) in messages" :key="i" :class="['msg', m.role]">
              <div class="bubble">{{ m.content }}</div>
            </div>
          </div>
          <div class="input-bar">
            <el-input v-model="input" type="textarea" :rows="3" placeholder="输入消息，回车发送（Shift+回车换行）" @keydown.enter.exact.prevent="send" />
            <el-button type="primary" :loading="loading" :disabled="!input" @click="send">发送</el-button>
          </div>
        </el-main>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import { listProviders } from '@/api';

const providers = ref([]);
const messages = ref([]);
const input = ref('');
const loading = ref(false);
const active = ref('new');
const msgBox = ref(null);

function onSelect() { messages.value = []; }

async function send() {
  if (!input.value.trim() || loading.value) return;
  const text = input.value;
  messages.value.push({ role: 'user', content: text });
  input.value = '';
  loading.value = true;
  messages.value.push({ role: 'assistant', content: '（Phase 1 仅展示 UI，待 Task #8 接入 SSE 流式输出）' });
  await nextTick();
  if (msgBox.value) msgBox.value.scrollTop = msgBox.value.scrollHeight;
  loading.value = false;
}

onMounted(async () => {
  try { providers.value = (await listProviders())?.items || []; } catch { providers.value = []; }
});
</script>

<style scoped>
.chat-page { display: flex; flex-direction: column; height: calc(100vh - 120px); }
.page-title { margin: 0 0 12px; font-weight: 600; }
.chat-shell { display: flex; height: 100%; min-height: 500px; }
.chat-side { background: #f5f7fa; border-right: 1px solid #ebeef5; }
.side-title { padding: 12px 16px; font-weight: 600; color: #606266; border-bottom: 1px solid #ebeef5; }
.chat-main { display: flex; flex-direction: column; padding: 0 !important; }
.messages { flex: 1; overflow-y: auto; padding: 16px; }
.msg { margin-bottom: 12px; display: flex; }
.msg.user { justify-content: flex-end; }
.bubble {
  max-width: 70%; padding: 10px 14px; border-radius: 8px;
  background: #ecf5ff; color: #303133;
}
.msg.user .bubble { background: #409EFF; color: #fff; }
.msg.assistant .bubble { background: #fff; border: 1px solid #ebeef5; }
.input-bar { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #ebeef5; }
</style>
