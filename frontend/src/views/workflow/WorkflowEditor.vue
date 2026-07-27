<template>
  <div class="wf-editor">
    <!-- 顶部工具栏 -->
    <div class="wf-editor__bar">
      <div class="wf-editor__title">
        <el-button text :icon="ArrowLeft" @click="goBack">返回</el-button>
        <span class="wf-editor__name">{{ wfName }}</span>
        <el-tag v-if="saved" type="success" size="small">已保存</el-tag>
        <el-tag v-else type="warning" size="small">未保存</el-tag>
      </div>
      <div class="wf-editor__actions">
        <el-button :icon="Upload" @click="openImport">导入 JSON</el-button>
        <el-button :icon="Download" @click="openExport">导出 JSON</el-button>
        <el-button :icon="VideoPlay" @click="goDebug">调试运行</el-button>
        <el-button type="primary" :icon="Check" :loading="saving" @click="save">保存</el-button>
      </div>
    </div>

    <div class="wf-editor__body">
      <!-- 左侧节点面板 -->
      <div class="wf-editor__palette">
        <div class="palette-title">节点</div>
        <div
          v-for="t in NODE_TYPES"
          :key="t.type"
          class="palette-item"
          :style="{ '--c': t.color }"
          @click="addNode(t.type)"
        >
          <el-icon :style="{ color: t.color }"><component :is="iconOf(t.icon)" /></el-icon>
          <div class="palette-item__text">
            <div class="palette-item__label">{{ t.label }}</div>
            <div class="palette-item__desc">{{ t.desc }}</div>
          </div>
        </div>
      </div>

      <!-- 中间画布 -->
      <div class="wf-editor__canvas">
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          :default-edge-options="{ animated: true, style: { stroke: '#94a3b8' } }"
          :fit-view-on-init="true"
          :min-zoom="0.3"
          @node-click="onNodeClick"
          @connect="onConnect"
          @nodes-change="onNodesChange"
        >
          <Background :gap="16" />
          <Controls />
          <MiniMap pannable zoomable />
        </VueFlow>
        <div v-if="!nodes.length" class="wf-editor__empty">
          从左侧点击节点，开始编排你的工作流
        </div>
      </div>

      <!-- 右侧节点配置抽屉 -->
      <el-drawer v-model="drawer" title="节点配置" size="360px" :with-header="true">
        <template v-if="selected">
          <el-form label-width="92px" label-position="top">
            <el-form-item label="节点名称">
              <el-input v-model="selected.data.label" placeholder="自定义名称（可选）" />
            </el-form-item>

            <!-- LLM -->
            <template v-if="selected.data.nodeType === 'llm'">
              <el-form-item label="Provider">
                <el-select v-model="selected.data.config.providerId" placeholder="默认 Provider" clearable style="width: 100%" @change="onProviderChange">
                  <el-option v-for="p in providers" :key="p.id" :label="`${p.name}（${p.providerType}）`" :value="p.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="模型">
                <el-select v-model="selected.data.config.model" placeholder="默认模型" clearable style="width: 100%">
                  <el-option v-for="m in llmModels" :key="m" :label="m" :value="m" />
                </el-select>
              </el-form-item>
              <el-form-item label="系统提示">
                <el-input v-model="selected.data.config.systemPrompt" type="textarea" :rows="2" placeholder="可留空" />
              </el-form-item>
              <el-form-item label="提示词模板">
                <el-input v-model="selected.data.config.promptTemplate" type="textarea" :rows="4" placeholder="如：把下面内容翻译为中文：{{input}}" />
                <div class="form-tip">可用变量：{{input}}、{{output}}、{{n1.output}}（上游节点输出）</div>
              </el-form-item>
            </template>

            <!-- Answer -->
            <template v-else-if="selected.data.nodeType === 'answer'">
              <el-form-item label="输出模板">
                <el-input v-model="selected.data.config.template" type="textarea" :rows="4" />
                <div class="form-tip">最终回复，可用 {{n1.output}} 引用上游节点输出</div>
              </el-form-item>
            </template>

            <!-- Condition -->
            <template v-else-if="selected.data.nodeType === 'condition'">
              <el-form-item label="判断对象">
                <el-select
                  v-model="selected.data.config.variable"
                  filterable
                  allow-create
                  default-first-option
                  style="width: 100%"
                  placeholder="默认 output，可输入 variables.n1.output"
                >
                  <el-option label="工作流输出 output" value="output" />
                  <el-option label="用户输入 input" value="input" />
                  <el-option label="上一节点 last_llm" value="last_llm" />
                </el-select>
              </el-form-item>
              <el-form-item label="运算符">
                <el-select v-model="selected.data.config.operator" style="width: 100%">
                  <el-option v-for="o in operators" :key="o.value" :label="o.label" :value="o.value" />
                </el-select>
              </el-form-item>
              <el-form-item label="比较值">
                <el-input v-model="selected.data.config.value" placeholder="与运算符比较的值" />
              </el-form-item>
              <div class="form-tip">真 → 绿色「真」句柄；假 → 红色「假」句柄</div>
            </template>

            <!-- Tool -->
            <template v-else-if="selected.data.nodeType === 'tool'">
              <el-form-item label="模板">
                <el-input v-model="selected.data.config.template" type="textarea" :rows="4" />
                <div class="form-tip">对上游输出做文本变换，如：总结：{{input}}</div>
              </el-form-item>
            </template>

            <!-- HTTP -->
            <template v-else-if="selected.data.nodeType === 'http'">
              <el-form-item label="方法">
                <el-select v-model="selected.data.config.method" style="width: 100%">
                  <el-option v-for="m in ['GET','POST','PUT','DELETE']" :key="m" :label="m" :value="m" />
                </el-select>
              </el-form-item>
              <el-form-item label="URL">
                <el-input v-model="selected.data.config.url" placeholder="https://api.example.com/hook" />
              </el-form-item>
              <el-form-item label="请求体模板">
                <el-input v-model="selected.data.config.bodyTemplate" type="textarea" :rows="3" placeholder="JSON，支持 {{变量}}" />
              </el-form-item>
            </template>

            <!-- Code -->
            <template v-else-if="selected.data.nodeType === 'code'">
              <el-form-item label="代码">
                <el-input v-model="selected.data.config.code" type="textarea" :rows="5" placeholder="return input;" />
                <div class="form-tip">入参：input / output / variables / artifacts；return 即输出</div>
              </el-form-item>
            </template>

            <!-- KB -->
            <template v-else-if="selected.data.nodeType === 'kb'">
              <el-alert type="info" :closable="false" title="知识库节点将在 Phase 3 上线，当前为占位" />
            </template>
          </el-form>

          <el-button type="danger" plain :icon="Delete" @click="removeSelected">删除该节点</el-button>
        </template>
      </el-drawer>

      <!-- 导入 JSON -->
      <el-dialog v-model="importVisible" title="导入工作流 JSON" width="600px">
        <el-input
          v-model="importText"
          type="textarea"
          :rows="16"
          placeholder='粘贴工作流 JSON，如：{"nodes":[...],"edges":[...]}'
        />
        <div class="form-tip" style="margin-top: 8px">
          支持完整 <code>{ "graphJson": {...} }</code> 或仅 <code>{ "nodes": [], "edges": [] }</code> 结构。导入后请点「保存」。
        </div>
        <template #footer>
          <el-button @click="importVisible = false">取消</el-button>
          <el-button type="primary" @click="doImport">导入并加载</el-button>
        </template>
      </el-dialog>

      <!-- 导出 JSON -->
      <el-dialog v-model="exportVisible" title="导出工作流 JSON" width="600px">
        <el-input :model-value="exportText" type="textarea" :rows="16" readonly />
        <template #footer>
          <el-button @click="exportVisible = false">关闭</el-button>
          <el-button type="primary" @click="copyExport">复制</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, markRaw, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  VueFlow,
  useVueFlow,
  Position,
} from '@vue-flow/core';
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MiniMap } from '@vue-flow/minimap';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/core/dist/theme-default.css';
import '@vue-flow/controls/dist/style.css';
import '@vue-flow/minimap/dist/style.css';
import { ArrowLeft, VideoPlay, Check, Delete, Upload, Download } from '@element-plus/icons-vue';
import * as ElIcons from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getWorkflow, updateWorkflow } from '@/api/workflows';
import { listProviders } from '@/api/provider';
import { NODE_TYPES, getNodeMeta } from './nodeMeta';
import WorkflowNode from './WorkflowNode.vue';

const route = useRoute();
const router = useRouter();
const { fitView } = useVueFlow();

const wfId = route.params.id;
const wfName = ref(route.query.name || '工作流');
const nodes = ref([]);
const edges = ref([]);
const providers = ref([]);
const saved = ref(true);
const saving = ref(false);
const drawer = ref(false);
const selectedId = ref(null);

const nodeTypes = { wf: markRaw(WorkflowNode) };

// ---- 导入 / 导出 JSON ----
const importVisible = ref(false);
const exportVisible = ref(false);
const importText = ref('');
const exportText = ref('');

function openImport() {
  importText.value = '';
  importVisible.value = true;
}
function openExport() {
  exportText.value = JSON.stringify(toBackend().graphJson, null, 2);
  exportVisible.value = true;
}
async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportText.value);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.warning('复制失败，请手动选择文本复制');
  }
}
function doImport() {
  try {
    const parsed = JSON.parse(importText.value);
    const g = parsed?.graphJson || parsed;
    if (!g || !Array.isArray(g.nodes)) throw new Error('缺少 nodes 数组');
    fromBackend(g);
    saved.value = false;
    importVisible.value = false;
    importText.value = '';
    ElMessage.success('已加载，记得点「保存」');
    setTimeout(() => fitView({ padding: 0.2 }), 50);
  } catch (e) {
    ElMessage.error('JSON 解析失败：' + (e?.message || e));
  }
}

const operators = [
  { value: 'contains', label: '包含' },
  { value: 'not_contains', label: '不包含' },
  { value: 'equals', label: '等于' },
  { value: 'not_equals', label: '不等于' },
  { value: 'regex', label: '正则匹配' },
  { value: 'truthy', label: '为真' },
  { value: 'falsy', label: '为假' },
];

const selected = computed(() => nodes.value.find((n) => n.id === selectedId.value) || null);
const llmModels = computed(() => {
  const p = providers.value.find((x) => x.id === selected.value?.data.config.providerId);
  return p?.models || [];
});

function iconOf(name) {
  return ElIcons[name] || ElIcons.Document;
}

// ---- 数据转换 ----
function fromBackend(g) {
  const gnodes = g?.nodes || [];
  const gedges = g?.edges || [];
  nodes.value = gnodes.map((n, i) => ({
    id: n.id,
    type: 'wf',
    position: n.position || { x: 120 + i * 40, y: 120 + i * 60 },
    data: {
      nodeType: n.type || 'llm',
      label: n.data?.label || '',
      config: n.data?.config || {},
    },
  }));
  edges.value = gedges.map((e) => ({
    id: `ed_${e.source}_${e.target}_${e.sourceHandle || ''}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle || undefined,
    label: e.sourceHandle === 'false' ? '假' : e.sourceHandle === 'true' ? '真' : '',
  }));
}

function toBackend() {
  return {
    graphJson: {
      nodes: nodes.value.map((n) => ({
        id: n.id,
        type: n.data.nodeType,
        position: n.position,
        data: { label: n.data.label || '', config: n.data.config || {} },
      })),
      edges: edges.value.map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
      })),
    },
  };
}

// ---- 节点操作 ----
function genId() {
  return 'nd_' + Math.random().toString(36).slice(2, 10);
}

function addNode(type) {
  const meta = getNodeMeta(type);
  const offset = nodes.value.length * 36;
  const node = {
    id: genId(),
    type: 'wf',
    position: { x: 200 + offset, y: 120 + offset },
    data: {
      nodeType: type,
      label: '',
      config: JSON.parse(JSON.stringify(meta.defaultConfig || {})),
    },
  };
  nodes.value.push(node);
  selectedId.value = node.id;
  saved.value = false;
  setTimeout(() => fitView({ padding: 0.2 }), 50);
}

function onConnect(params) {
  edges.value.push({
    id: `ed_${params.source}_${params.target}_${params.sourceHandle || ''}`,
    source: params.source,
    target: params.target,
    sourceHandle: params.sourceHandle || undefined,
    label: params.sourceHandle === 'false' ? '假' : params.sourceHandle === 'true' ? '真' : '',
  });
  saved.value = false;
}

function onNodeClick({ node }) {
  selectedId.value = node.id;
  drawer.value = true;
}

function onNodesChange(changes) {
  // 节点被删除时关闭抽屉
  const removed = changes.find((c) => c.type === 'remove');
  if (removed && removed.id === selectedId.value) {
    drawer.value = false;
    selectedId.value = null;
  }
  saved.value = false;
}

function onProviderChange() {
  if (selected.value) selected.value.data.config.model = '';
}

function removeSelected() {
  if (!selectedId.value) return;
  nodes.value = nodes.value.filter((n) => n.id !== selectedId.value);
  edges.value = edges.value.filter(
    (e) => e.source !== selectedId.value && e.target !== selectedId.value,
  );
  drawer.value = false;
  selectedId.value = null;
  saved.value = false;
}

// ---- 保存 ----
async function save() {
  saving.value = true;
  try {
    await updateWorkflow(wfId, toBackend());
    saved.value = true;
    ElMessage.success('已保存');
  } finally {
    saving.value = false;
  }
}

function goBack() {
  router.push('/workflows');
}
function goDebug() {
  if (!saved.value) {
    ElMessage.warning('请先保存再调试');
    return;
  }
  router.push({ path: `/workflows/${wfId}/debug`, query: { name: wfName.value } });
}

onMounted(async () => {
  const [wf, ps] = await Promise.all([getWorkflow(wfId), listProviders()]);
  wfName.value = wf.name || wfName.value;
  fromBackend(wf.graphJson);
  providers.value = ps || [];
});
</script>

<style scoped>
.wf-editor { display: flex; flex-direction: column; height: 100%; }
.wf-editor__bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 16px; border-bottom: 1px solid #e5e7eb; background: #fff;
}
.wf-editor__title { display: flex; align-items: center; gap: 10px; }
.wf-editor__name { font-weight: 600; font-size: 15px; }
.wf-editor__body { flex: 1; display: flex; min-height: 0; }
.wf-editor__palette {
  width: 200px; border-right: 1px solid #e5e7eb; overflow-y: auto; padding: 10px; background: #fafafa;
}
.palette-title { font-size: 12px; color: #6b7280; margin-bottom: 8px; }
.palette-item {
  display: flex; align-items: center; gap: 8px; padding: 8px; margin-bottom: 8px;
  background: #fff; border: 1px solid #e5e7eb; border-left: 3px solid var(--c);
  border-radius: 6px; cursor: pointer; transition: all 0.15s;
}
.palette-item:hover { box-shadow: 0 2px 6px rgba(0,0,0,0.1); transform: translateY(-1px); }
.palette-item__label { font-size: 13px; font-weight: 600; }
.palette-item__desc { font-size: 11px; color: #9ca3af; }
.wf-editor__canvas { flex: 1; position: relative; }
.wf-editor__empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  color: #9ca3af; pointer-events: none; font-size: 14px;
}
.form-tip { font-size: 11px; color: #9ca3af; line-height: 1.4; }
</style>
