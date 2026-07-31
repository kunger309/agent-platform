<template>
  <div class="provider-list page-container">
    <div class="page-header">
      <h2>模型提供商</h2>
      <el-button type="primary" :icon="Plus" @click="openCreate">添加模型提供商</el-button>
    </div>

    <div class="table-card">
    <el-table :data="list" v-loading="loading" stripe>
      <el-table-column prop="name" label="名称" min-width="140" />
      <el-table-column label="类型" width="120">
        <template #default="{ row }">
          <el-tag>{{ providerLabel(row.providerType) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="baseUrl" label="端点" min-width="240" show-overflow-tooltip />
      <el-table-column label="API Key" width="200">
        <template #default="{ row }">
          <span class="api-key">{{ row.apiKeyMasked }}</span>
        </template>
      </el-table-column>
      <el-table-column label="支持模型" min-width="200">
        <template #default="{ row }">
          <el-tag v-for="m in row.models" :key="m" type="info" size="small" style="margin: 2px">
            {{ m }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="默认" width="80" align="center">
        <template #default="{ row }">
          <el-icon v-if="row.isDefault" color="#67C23A" size="18"><Check /></el-icon>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
            {{ row.status === 'active' ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="testIt(row)" :loading="testingId === row.id">测试</el-button>
          <el-button size="small" type="primary" @click="openEdit(row)">编辑</el-button>
          <el-popconfirm title="确认删除该 Provider？" @confirm="removeIt(row)">
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
          <el-input v-model="form.name" placeholder="如：MiniMax-生产" />
        </el-form-item>
        <el-form-item label="类型" prop="providerType">
          <el-select v-model="form.providerType" @change="onTypeChange" style="width: 100%">
            <el-option v-for="t in PROVIDER_TYPES" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="端点地址" prop="baseUrl">
          <el-input v-model="form.baseUrl" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="API Key" prop="apiKey">
          <el-input
            v-model="form.apiKey"
            type="password"
            show-password
            :placeholder="dialog.editing ? '留空则不修改' : '请输入 API Key'"
          />
        </el-form-item>
        <el-form-item label="支持模型" prop="models">
          <el-select
            v-model="form.models"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入模型名"
            style="width: 100%"
          >
            <el-option
              v-for="m in availableModels"
              :key="m"
              :label="m"
              :value="m"
            />
          </el-select>
          <div class="form-tip">从下拉选，也可手动输入自定义模型</div>
        </el-form-item>
        <el-form-item label="默认模型">
          <el-select v-model="form.defaultModel" placeholder="可选" style="width: 100%" allow-create filterable>
            <el-option v-for="m in form.models" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="设为默认">
          <el-switch v-model="form.isDefault" />
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
import { Plus, Check } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import {
  listProviders,
  createProvider,
  updateProvider,
  deleteProvider,
  testProvider,
  PROVIDER_TYPES,
  DEFAULT_MODELS,
} from '@/api/provider';

const list = ref([]);
const loading = ref(false);
const testingId = ref(null);
const saving = ref(false);
const formRef = ref(null);

const dialog = reactive({ visible: false, editing: false, title: '添加模型提供商' });
// 编辑时记录原 provider 的 id（避免保存时按名字反查，用户改了名字就 404）
const editingId = ref(null);
const form = reactive({
  name: '',
  providerType: '', // 新建时不预选类型，强制用户主动选择
  baseUrl: '',
  apiKey: '',
  models: [],
  defaultModel: '',
  isDefault: false,
});

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  providerType: [{ required: true, message: '请选择类型', trigger: 'change' }],
  baseUrl: [{ required: true, message: '请输入端点地址', trigger: 'blur' }],
  apiKey: [
    {
      validator: (_, value, cb) => {
        if (!dialog.editing && !value) return cb(new Error('请输入 API Key'));
        cb();
      },
      trigger: 'blur',
    },
  ],
  models: [{ required: true, type: 'array', min: 1, message: '至少添加一个模型', trigger: 'change' }],
};

const availableModels = computed(() => DEFAULT_MODELS[form.providerType] || []);

function providerLabel(type) {
  return PROVIDER_TYPES.find((t) => t.value === type)?.label || type;
}

function onTypeChange(type) {
  const def = PROVIDER_TYPES.find((t) => t.value === type);
  if (def) form.baseUrl = def.defaultBaseUrl;
  form.models = (DEFAULT_MODELS[type] || []).slice();
  form.defaultModel = form.models[0] || '';
}

async function load() {
  loading.value = true;
  try {
    list.value = await listProviders();
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, {
    name: '',
    providerType: '', // 让用户主动选类型
    baseUrl: '',
    apiKey: '',
    models: [],
    defaultModel: '',
    isDefault: false,
  });
  dialog.editing = false;
  dialog.title = '添加模型提供商';
  dialog.visible = true;
}

function openEdit(row) {
  editingId.value = row.id; // ← 关键：保存原 id
  Object.assign(form, {
    name: row.name,
    providerType: row.providerType,
    baseUrl: row.baseUrl,
    apiKey: '', // 不回显
    models: [...row.models],
    defaultModel: row.defaultModel || '',
    isDefault: row.isDefault,
  });
  dialog.editing = true;
  dialog.title = `编辑 ${row.name}`;
  dialog.visible = true;
}

async function saveIt() {
  await formRef.value.validate();
  saving.value = true;
  try {
    if (dialog.editing) {
      if (!editingId.value) {
        // 兜底：万一没拿到 id，再按名字反查一次
        const byName = list.value.find((p) => p.name === form.name);
        if (!byName) {
          ElMessage.error('无法定位原 Provider，请关闭后重试');
          return;
        }
        editingId.value = byName.id;
      }
      const payload = { ...form };
      if (!payload.apiKey) delete payload.apiKey; // 没填就不传
      await updateProvider(editingId.value, payload);
    } else {
      await createProvider(form);
    }
    ElMessage.success('已保存');
    dialog.visible = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function removeIt(row) {
  await deleteProvider(row.id);
  ElMessage.success('已删除');
  await load();
}

async function testIt(row) {
  testingId.value = row.id;
  try {
    const res = await testProvider(row.id);
    if (res?.success) {
      ElMessage.success(`连接成功 (${res.latencyMs}ms)：${res.reply?.slice(0, 30) || ''}`);
    } else {
      ElMessage.error(`连接失败：${res?.error || '未知错误'}`);
    }
  } finally {
    testingId.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.provider-list { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { margin: 0; font-weight: 600; }
.api-key { font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace; color: var(--el-text-color-secondary); }
.form-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
</style>