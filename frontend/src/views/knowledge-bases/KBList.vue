<template>
  <div class="kb-list page-container">
    <div class="page-header">
      <h2>知识库</h2>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建知识库</el-button>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column label="名称" min-width="180">
          <template #default="{ row }">
            <a class="kb-link" @click="goDetail(row)">{{ row.name }}</a>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="muted">{{ row.description || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Embedding" min-width="200">
          <template #default="{ row }">
            <div class="emb-cell">
              <el-tag size="small" type="warning">{{ row.embeddingModel || '—' }}</el-tag>
              <span class="muted provider">{{ providerName(row.embeddingProviderId) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="文档数" width="100" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.documentCount || 0 }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '启用' : '归档' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="goDetail(row)">文档</el-button>
            <el-button size="small" type="primary" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确认删除该知识库？" @confirm="removeIt(row)">
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
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：公司制度知识库" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="可选" />
        </el-form-item>
        <el-form-item label="Embedding 提供商" prop="embeddingProviderId">
          <el-select
            v-model="form.embeddingProviderId"
            placeholder="选择模型提供商"
            style="width: 100%"
            @change="onProviderChange"
          >
            <el-option
              v-for="p in providerOptions"
              :key="p.id"
              :label="p.name"
              :value="p.id"
            />
          </el-select>
          <div class="form-tip">用于调用_embeddings_接口生成向量，须为可用（启用）的提供商</div>
        </el-form-item>
        <el-form-item label="Embedding 模型" prop="embeddingModel">
          <el-select
            v-model="form.embeddingModel"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入模型名"
            style="width: 100%"
          >
            <el-option v-for="m in embeddingModelOptions" :key="m" :label="m" :value="m" />
          </el-select>
          <div class="form-tip">MiniMax 用 embo-01 / embo-02；OpenAI 用 text-embedding-3-small 等</div>
        </el-form-item>
        <el-form-item label="检索 TopK">
          <el-input-number v-model="form.topK" :min="1" :max="50" />
        </el-form-item>
        <el-form-item label="相似度阈值">
          <el-input-number v-model="form.scoreThreshold" :min="0" :max="1" :step="0.05" :precision="2" />
          <div class="form-tip">低于该余弦相似度的结果将被丢弃（0 = 不限制）</div>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option label="启用" value="active" />
            <el-option label="归档" value="archived" />
          </el-select>
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
import {
  listKnowledgeBases,
  getKnowledgeBase,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from '@/api/knowledge-bases';
import { listProviders } from '@/api/provider';

const router = useRouter();

const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const formRef = ref(null);
const providers = ref([]);

const providerOptions = computed(() =>
  providers.value.filter((p) => p.status === 'active'),
);
const providerMap = computed(() => {
  const m = {};
  providers.value.forEach((p) => (m[p.id] = p));
  return m;
});

function providerName(id) {
  const p = providerMap.value[id];
  return p ? `· ${p.name}` : '';
}

// embedding 模型预设：随所选提供商类型变化
const embeddingModelOptions = computed(() => {
  const p = providerMap.value[form.embeddingProviderId];
  if (p?.providerType === 'MiniMax') return ['embo-01', 'embo-02'];
  if (p?.providerType === 'openai') return ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'];
  return ['embo-01', 'text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'];
});

const dialog = reactive({ visible: false, editing: false, title: '新建知识库' });
const editingId = ref(null);
const form = reactive({
  name: '',
  description: '',
  embeddingProviderId: '',
  embeddingModel: 'embo-01',
  topK: 5,
  scoreThreshold: 0,
  status: 'active',
});

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  embeddingProviderId: [{ required: true, message: '请选择 Embedding 提供商', trigger: 'change' }],
  embeddingModel: [{ required: true, message: '请选择/输入 Embedding 模型', trigger: 'change' }],
};

function buildConfig() {
  const cfg = {};
  if (form.topK) cfg.topK = form.topK;
  if (form.scoreThreshold) cfg.scoreThreshold = form.scoreThreshold;
  return cfg;
}

async function load() {
  loading.value = true;
  try {
    list.value = await listKnowledgeBases();
  } finally {
    loading.value = false;
  }
}

async function loadProviders() {
  try {
    providers.value = await listProviders();
  } catch {
    providers.value = [];
  }
}

function openCreate() {
  editingId.value = null;
  Object.assign(form, {
    name: '',
    description: '',
    embeddingProviderId: providerOptions.value[0]?.id || '',
    embeddingModel: 'embo-01',
    topK: 5,
    scoreThreshold: 0,
    status: 'active',
  });
  dialog.editing = false;
  dialog.title = '新建知识库';
  dialog.visible = true;
}

async function openEdit(row) {
  editingId.value = row.id;
  // 回填时拉详情以拿到 embeddingProviderId（列表已含，但保险起见直取详情）
  let detail = row;
  try {
    detail = await getKnowledgeBase(row.id);
  } catch {
    /* 用列表行兜底 */
  }
  const cfg = detail.retrievalConfig || {};
  Object.assign(form, {
    name: detail.name,
    description: detail.description || '',
    embeddingProviderId: detail.embeddingProviderId || '',
    embeddingModel: detail.embeddingModel || 'embo-01',
    topK: cfg.topK || 5,
    scoreThreshold: cfg.scoreThreshold || 0,
    status: detail.status || 'active',
  });
  dialog.editing = true;
  dialog.title = `编辑 ${detail.name}`;
  dialog.visible = true;
}

function onProviderChange() {
  // 切换到 MiniMax 且模型为空/非 embo 时，给个合理默认
  const p = providerMap.value[form.embeddingProviderId];
  if (p?.providerType === 'MiniMax' && !/embo/i.test(form.embeddingModel)) {
    form.embeddingModel = 'embo-01';
  }
}

function goDetail(row) {
  router.push(`/knowledge-bases/${row.id}`);
}

async function saveIt() {
  await formRef.value.validate();
  saving.value = true;
  try {
    const payload = {
      name: form.name,
      description: form.description || undefined,
      embeddingProviderId: form.embeddingProviderId,
      embeddingModel: form.embeddingModel,
      retrievalConfig: buildConfig(),
      status: form.status,
    };
    if (dialog.editing) {
      await updateKnowledgeBase(editingId.value, payload);
    } else {
      await createKnowledgeBase(payload);
    }
    ElMessage.success('已保存');
    dialog.visible = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function removeIt(row) {
  await deleteKnowledgeBase(row.id);
  ElMessage.success('已删除');
  await load();
}

onMounted(() => {
  load();
  loadProviders();
});
</script>

<style scoped>
.kb-list { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.kb-link { color: var(--el-color-primary); cursor: pointer; font-weight: 500; }
.kb-link:hover { text-decoration: underline; }
.muted { color: var(--el-text-color-secondary); }
.emb-cell { display: flex; flex-direction: column; gap: 2px; }
.emb-cell .provider { font-size: 12px; color: var(--el-text-color-secondary); }
.form-tip { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 4px; }
</style>
