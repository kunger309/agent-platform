<template>
  <div class="wf-debug">
    <div class="wf-debug__bar">
      <el-button text :icon="ArrowLeft" @click="goBack">返回</el-button>
      <span class="wf-debug__name">{{ wfName }}</span>
      <el-button v-if="running" type="danger" :icon="VideoPause" @click="stop">停止</el-button>
    </div>

    <div class="wf-debug__body">
      <!-- 左：输入与控制 -->
      <div class="wf-debug__side">
        <div class="panel-title">测试输入</div>
        <el-input
          v-model="input"
          type="textarea"
          :rows="6"
          placeholder="输入一段文本作为工作流的 {{input}}"
        />
        <el-button
          type="primary"
          class="run-btn"
          :icon="VideoPlay"
          :loading="running"
          @click="run"
        >运行</el-button>

        <div class="panel-title" style="margin-top: 20px">最终输出</div>
        <div class="final-output">{{ finalOutput || '（运行后在此显示）' }}</div>
        <el-alert v-if="errorMsg" type="error" :closable="false" :title="errorMsg" style="margin-top: 12px" />
      </div>

      <!-- 右：实时执行看板 -->
      <div class="wf-debug__main">
        <div class="panel-title">执行过程（{{ steps.length }} 个节点）</div>
        <div v-if="!steps.length" class="empty">点击「运行」查看每个节点的输入 / 输出</div>
        <div
          v-for="s in steps"
          :key="s.nodeId"
          class="step"
          :class="{ active: s.status === 'running', done: s.status === 'done' }"
        >
          <div class="step__head">
            <el-icon :style="{ color: metaOf(s.nodeType).color }">
              <component :is="iconOf(metaOf(s.nodeType).icon)" />
            </el-icon>
            <span class="step__title">{{ metaOf(s.nodeType).label }}</span>
            <span v-if="s.label" class="step__name">{{ s.label }}</span>
            <span class="step__status">
              <el-icon v-if="s.status === 'running'" class="is-loading"><Loading /></el-icon>
              <el-tag v-else-if="s.status === 'done'" type="success" size="small">完成 {{ s.durationMs }}ms</el-tag>
            </span>
          </div>
          <div v-if="s.input" class="step__io">
            <span class="io-label">输入</span>
            <pre>{{ inputPreview(s.input) }}</pre>
          </div>
          <div v-if="s.token || s.output" class="step__io">
            <span class="io-label">输出</span>
            <pre>{{ s.status === 'running' ? s.token : outputText(s.output) }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft, VideoPlay, VideoPause, Loading } from '@element-plus/icons-vue';
import * as ElIcons from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getWorkflow, runWorkflowStream } from '@/api/workflows';
import { getNodeMeta } from './nodeMeta';

const route = useRoute();
const router = useRouter();
const wfId = route.params.id;
const wfName = ref(route.query.name || '工作流');

const input = ref('');
const running = ref(false);
const finalOutput = ref('');
const errorMsg = ref('');
const steps = ref([]);
let controller = null;

function iconOf(name) {
  return ElIcons[name] || ElIcons.Document;
}
function metaOf(type) {
  return getNodeMeta(type);
}
function inputPreview(v) {
  if (!v) return '';
  try {
    return JSON.stringify(v, null, 2).slice(0, 400);
  } catch {
    return String(v);
  }
}
function outputText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function reset() {
  steps.value = [];
  finalOutput.value = '';
  errorMsg.value = '';
}

function run() {
  if (running.value) return;
  reset();
  running.value = true;
  try {
    controller = runWorkflowStream(wfId, input.value, {
      onRunStart: () => {},
      onNodeStart: (ev) => {
        steps.value.push({
          nodeId: ev.nodeId,
          nodeType: ev.nodeType,
          label: ev.label || '',
          status: 'running',
          input: ev.input,
          token: '',
          output: null,
          durationMs: 0,
        });
      },
      onNodeToken: (ev) => {
        const s = steps.value.find((x) => x.nodeId === ev.nodeId);
        if (s) s.token += ev.delta;
      },
      onNodeEnd: (ev) => {
        const s = steps.value.find((x) => x.nodeId === ev.nodeId);
        if (s) {
          s.status = 'done';
          s.output = ev.output;
          s.durationMs = ev.durationMs || 0;
        }
      },
      onDone: (ev) => {
        if (ev && ev.output != null) finalOutput.value = outputText(ev.output);
        running.value = false;
      },
      onError: (msg) => {
        errorMsg.value = msg;
        running.value = false;
      },
    });
  } catch (e) {
    errorMsg.value = e.message || String(e);
    running.value = false;
  }
}

function stop() {
  if (controller) controller.abort();
  running.value = false;
}

function goBack() {
  router.push('/workflows');
}

onBeforeUnmount(() => {
  if (controller) controller.abort();
});

// 预加载名称
getWorkflow(wfId)
  .then((wf) => {
    wfName.value = wf.name || wfName.value;
  })
  .catch(() => {});
</script>

<style scoped>
.wf-debug { display: flex; flex-direction: column; height: 100%; }
.wf-debug__bar {
  display: flex; align-items: center; gap: 10px; padding: 8px 16px;
  border-bottom: 1px solid var(--border-base); background: var(--surface);
}
.wf-debug__name { font-weight: 600; color: var(--text-primary); }
.wf-debug__body { flex: 1; display: flex; min-height: 0; }
.wf-debug__side {
  width: 320px; border-right: 1px solid var(--border-base);
  padding: 16px; overflow-y: auto; background: var(--surface-muted);
}
.wf-debug__main { flex: 1; padding: 16px; overflow-y: auto; }
.panel-title { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 8px; }
.run-btn { width: 100%; margin-top: 12px; }
.final-output {
  background: var(--el-fill-color-lighter); border: 1px solid var(--border-base); border-radius: 6px;
  padding: 10px; min-height: 60px; white-space: pre-wrap; word-break: break-all;
  font-size: 13px; color: var(--text-primary);
}
.empty { color: var(--el-text-color-placeholder); font-size: 13px; padding: 20px 0; }
.step {
  border: 1px solid var(--border-base); border-radius: 8px; margin-bottom: 10px; overflow: hidden;
  background: var(--surface);
}
.step.active {
  border-color: var(--purple);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--purple) 18%, transparent);
}
.step__head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--surface-muted); }
.step__title { font-weight: 600; font-size: 13px; color: var(--text-primary); }
.step__name { color: var(--el-text-color-secondary); font-size: 12px; }
.step__status { margin-left: auto; display: flex; align-items: center; }
.step__io { padding: 6px 12px; border-top: 1px solid var(--el-border-color-extra-light); }
.io-label { font-size: 11px; color: var(--el-text-color-placeholder); }
.step__io pre {
  margin: 4px 0 0; white-space: pre-wrap; word-break: break-all;
  font-size: 12px; color: var(--el-text-color-regular); max-height: 220px; overflow-y: auto;
  font-family: -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif;
}
</style>
