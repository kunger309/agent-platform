<template>
  <div class="agent-list page-container">
    <div class="page-header">
      <h2>聊天智能体</h2>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建智能体</el-button>
    </div>

    <div class="table-card">
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">
          <el-tag :type="row.type === 'chat' ? 'success' : 'warning'" size="small">{{ row.type }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusColor(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updatedAt" label="更新时间" width="180">
        <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="320" fixed="right">
        <template #default="{ row }">
          <el-button size="small" type="primary" @click="goDebug(row)">调试</el-button>
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-tooltip :content="publishHint(row) || '点击切换为草稿'" placement="top" :disabled="row.status !== 'published' && publishHint(row) !== ''">
            <el-button
              v-if="row.status !== 'published'"
              size="small"
              type="success"
              :disabled="publishHint(row) !== ''"
              @click="publishIt(row, true)"
            >发布</el-button>
            <el-button
              v-else
              size="small"
              @click="publishIt(row, false)"
            >取消发布</el-button>
          </el-tooltip>
          <el-popconfirm title="确认删除？" @confirm="removeIt(row)">
            <template #reference>
              <el-button size="small" type="danger">删除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
    </div>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="dialog.visible" :title="dialog.title" width="640px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：客服助手" />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-radio-group v-model="form.type">
            <el-radio value="chat">聊天</el-radio>
            <el-radio value="workflow" disabled>流程编排（Phase 2）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="模型提供商" prop="providerId">
          <el-select v-model="form.providerId" placeholder="选择已配置的模型提供商" style="width: 100%" @change="onProviderChange">
            <el-option
              v-for="p in providers"
              :key="p.id"
              :label="`${p.name}（${providerLabel(p.providerType)}）`"
              :value="p.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="模型" prop="model">
          <el-select v-model="form.model" placeholder="选择模型" style="width: 100%">
            <el-option v-for="m in availableModels" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="系统提示">
          <el-input v-model="form.systemPrompt" type="textarea" :rows="3" placeholder="如：你是一个友好的客服助手" />
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="form.temperature" :min="0" :max="2" :step="0.1" show-input />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveIt">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { listProviders, PROVIDER_TYPES } from '@/api/provider';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent } from '@/api/agent';

const router = useRouter();
const list = ref([]);
const providers = ref([]);
const loading = ref(false);
const saving = ref(false);
const formRef = ref(null);

const dialog = reactive({ visible: false, editing: false, id: null, title: '新建智能体' });
const form = reactive({
  name: '',
  type: 'chat',
  description: '',
  providerId: '',
  model: '',
  systemPrompt: '',
  temperature: 0.7,
});

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  providerId: [{ required: true, message: '请选择模型提供商', trigger: 'change' }],
  model: [{ required: true, message: '请选择模型', trigger: 'change' }],
};

const availableModels = computed(() => {
  const p = providers.value.find((x) => x.id === form.providerId);
  const models = [...(p?.models || [])];
  // Provider 后续删改模型时，仍保留当前智能体已保存的模型，避免编辑时空白。
  if (form.model && !models.includes(form.model)) models.unshift(form.model);
  return models;
});

function providerLabel(type) {
  return PROVIDER_TYPES.find((t) => t.value === type)?.label || type;
}

function statusLabel(s) {
  return { draft: '草稿', published: '已发布', archived: '归档' }[s] || s;
}
function statusColor(s) {
  return { draft: 'info', published: 'success', archived: 'warning' }[s] || '';
}
function formatTime(t) {
  return t ? new Date(t).toLocaleString('zh-CN') : '-';
}

async function load() {
  loading.value = true;
  try {
    [list.value, providers.value] = await Promise.all([listAgents(), listProviders()]);
    // 异步为每个草稿智能体检查发布条件（不阻塞列表渲染）
    for (const row of list.value) {
      if (row.status !== 'published') refreshPublishReady(row);
    }
  } finally {
    loading.value = false;
  }
}

function onProviderChange() {
  const p = providers.value.find((x) => x.id === form.providerId);
  form.model = p?.defaultModel || p?.models?.[0] || '';
}

function openCreate() {
  Object.assign(form, {
    name: '',
    type: 'chat',
    description: '',
    providerId: '',
    model: '',
    systemPrompt: '你是一个专业、友好的 AI 助手。请用简洁准确的中文回答用户问题。',
    temperature: 0.7,
  });
  dialog.editing = false;
  dialog.id = null;
  dialog.title = '新建智能体';
  dialog.visible = true;
}

async function openEdit(row) {
  dialog.editing = true;
  dialog.id = row.id;
  dialog.title = `编辑 ${row.name}`;
  dialog.visible = true;

  try {
    // 列表接口只返回摘要字段，编辑必须读取详情才能回显模型配置和系统提示词。
    const detail = await getAgent(row.id);
    const config = detail?.modelConfig && typeof detail.modelConfig === 'object'
      ? detail.modelConfig
      : {};
    Object.assign(form, {
      name: detail.name ?? row.name ?? '',
      type: detail.type ?? row.type ?? 'chat',
      description: detail.description ?? row.description ?? '',
      providerId: config.providerId ?? '',
      model: config.model ?? '',
      systemPrompt: detail.systemPrompt ?? '',
      temperature: typeof config.temperature === 'number' ? config.temperature : 0.7,
    });
  } catch (error) {
    dialog.visible = false;
    ElMessage.error(`加载智能体详情失败：${error?.message || error}`);
  }
}

async function saveIt() {
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = {
      name: form.name,
      type: form.type,
      description: form.description,
      systemPrompt: form.systemPrompt,
      modelConfig: {
        providerId: form.providerId,
        model: form.model,
        temperature: form.temperature,
      },
    };
    if (dialog.editing) {
      await updateAgent(dialog.id, payload);
    } else {
      await createAgent(payload);
    }
    ElMessage.success('已保存');
    dialog.visible = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function removeIt(row) {
  await deleteAgent(row.id);
  ElMessage.success('已删除');
  await load();
}

// 发布校验：列表行不携带 modelConfig / systemPrompt，
// 这里只做基于列表行可见字段的粗校验（名称）。最终校验在 publishIt 内异步重新拉详情。
const publishReady = ref({}); // id -> {ok, reason}

async function refreshPublishReady(row) {
  try {
    const detail = await getAgent(row.id);
    const cfg = detail?.modelConfig && typeof detail.modelConfig === 'object' ? detail.modelConfig : {};
    const reasons = [];
    if (!detail?.name) reasons.push('名称');
    if (!cfg.providerId) reasons.push('Provider');
    if (!cfg.model) reasons.push('模型');
    publishReady.value[row.id] = reasons.length
      ? { ok: false, reason: `需补充：${reasons.join('、')}` }
      : { ok: true, reason: '' };
  } catch (e) {
    publishReady.value[row.id] = { ok: false, reason: '校验失败' };
  }
}

function publishHint(row) {
  return publishReady.value[row.id]?.reason || '';
}

async function publishIt(row, toPublish) {
  if (toPublish && !publishReady.value[row.id]?.ok) {
    // 兜底再校验一次，避免初次加载未完成时漏掉
    await refreshPublishReady(row);
    if (!publishReady.value[row.id]?.ok) {
      ElMessage.warning(publishReady.value[row.id]?.reason || '请先补全配置');
      return;
    }
  }
  try {
    await updateAgent(row.id, { status: toPublish ? 'published' : 'draft' });
    ElMessage.success(toPublish ? '已发布' : '已取消发布');
    await load();
  } catch (e) {
    ElMessage.error('操作失败：' + (e?.message || e));
  }
}

function goDebug(row) {
  router.push({ path: `/agents/${row.id}/debug`, query: { name: row.name } });
}

onMounted(load);
</script>

<style scoped>
.agent-list { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { margin: 0; font-weight: 600; }
</style>