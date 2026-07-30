<template>
  <div class="skill-list page-container">
    <div class="page-header">
      <h2>技能市场</h2>
      <el-button type="primary" :icon="Plus" @click="openCreate">新建技能</el-button>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe>
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="row.type === 'function' ? 'warning' : 'success'" size="small">
              {{ row.type === 'function' ? 'JS 函数' : 'OpenAPI' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="版本" width="80">
          <template #default="{ row }">{{ row.versions?.[0]?.version || '-' }}</template>
        </el-table-column>
        <el-table-column label="绑定" width="80">
          <template #default="{ row }">{{ row._count?.agentSkills || 0 }}</template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="180">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="openTest(row)">测试</el-button>
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-popconfirm title="确认删除该技能？" @confirm="removeIt(row)">
              <template #reference>
                <el-button size="small" type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新建技能 -->
    <el-dialog v-model="createDialog.visible" title="新建技能" width="720px" destroy-on-close>
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="createForm.name" placeholder="如：天气查询" />
        </el-form-item>
        <el-form-item label="类型" required>
          <el-radio-group v-model="createForm.type">
            <el-radio value="function">JS 函数</el-radio>
            <el-radio value="openapi">OpenAPI</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="createForm.description" type="textarea" :rows="2" />
        </el-form-item>

        <template v-if="createForm.type === 'function'">
          <el-form-item label="函数代码" required>
            <el-input
              v-model="createForm.sourceCode"
              type="textarea"
              :rows="8"
              class="code-area"
              placeholder="return input.a + input.b;  // 入参名为 input，return 返回结果"
            />
          </el-form-item>
          <el-form-item label="参数 Schema">
            <el-input
              v-model="createForm.schemaJsonText"
              type="textarea"
              :rows="3"
              class="code-area"
              placeholder='可选，JSON：{"properties":{"a":{"type":"number"}}}'
            />
          </el-form-item>
        </template>

        <template v-else>
          <el-form-item label="OpenAPI 文档" required>
            <el-input
              v-model="createForm.openapiSchemaText"
              type="textarea"
              :rows="10"
              class="code-area"
              placeholder="粘贴 OpenAPI JSON 或 YAML 文档"
            />
          </el-form-item>
        </template>

        <el-form-item label="超时(ms)">
          <el-input-number v-model="createForm.maxDuration" :min="200" :max="30000" :step="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 编辑技能 -->
    <el-dialog v-model="editDialog.visible" :title="`编辑 ${editDialog.name}`" width="720px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="名称">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="状态">
          <el-switch
            v-model="editForm.active"
            active-text="启用"
            inactive-text="停用"
            :active-value="true"
            :inactive-value="false"
          />
        </el-form-item>

        <el-divider>当前版本（v{{ editForm.version }}）内容</el-divider>
        <template v-if="editForm.type === 'function'">
          <el-form-item label="函数代码">
            <el-input v-model="editForm.sourceCode" type="textarea" :rows="8" class="code-area" />
          </el-form-item>
        </template>
        <template v-else>
          <el-form-item label="OpenAPI 文档">
            <el-input v-model="editForm.openapiSchemaText" type="textarea" :rows="10" class="code-area" />
          </el-form-item>
        </template>
        <el-form-item label="超时(ms)">
          <el-input-number v-model="editForm.maxDuration" :min="200" :max="30000" :step="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialog.visible = false">取消</el-button>
        <el-button @click="saveMeta">保存元数据</el-button>
        <el-button type="primary" :loading="saving" @click="saveNewVersion">保存为新版本</el-button>
      </template>
    </el-dialog>

    <!-- 测试调用 -->
    <el-dialog v-model="testDialog.visible" :title="`测试：${testDialog.name}`" width="720px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="输入参数">
          <el-input
            v-model="testDialog.inputText"
            type="textarea"
            :rows="6"
            class="code-area"
            :placeholder="testDialogPlaceholder"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="testDialog.running" @click="runTest">运行</el-button>
        </el-form-item>
        <el-form-item label="结果" v-if="testDialog.result">
          <div class="test-result" :class="testDialog.result.status">
            <div class="test-meta">
              状态：{{ testDialog.result.status === 'success' ? '成功' : '失败' }}
              · 耗时：{{ testDialog.result.durationMs }} ms
            </div>
            <pre class="test-output">{{ formatOutput(testDialog.result.output, testDialog.result.error) }}</pre>
          </div>
        </el-form-item>
      </el-form>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import {
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  createSkillVersion,
  testSkill,
} from '@/api/skills';

const list = ref([]);
const loading = ref(false);
const saving = ref(false);

const createDialog = reactive({ visible: false });
const createForm = reactive({
  name: '',
  type: 'function',
  description: '',
  sourceCode: '',
  openapiSchemaText: '',
  schemaJsonText: '',
  maxDuration: 2000,
});

const editDialog = reactive({ visible: false, id: null, name: '', version: 1, type: 'function' });
const editForm = reactive({
  name: '',
  description: '',
  active: true,
  sourceCode: '',
  openapiSchemaText: '',
  maxDuration: 2000,
  type: 'function',
  version: 1,
});

const testDialog = reactive({
  visible: false,
  id: null,
  name: '',
  type: 'function',
  schema: null,
  inputText: '{}',
  running: false,
  result: null,
});

function formatTime(t) {
  return t ? new Date(t).toLocaleString('zh-CN') : '-';
}
function formatOutput(output, error) {
  if (error) return 'Error: ' + error;
  if (output === undefined || output === null) return '';
  return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
}
function parseJsonOrNull(text, fallback) {
  if (!text || !text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('JSON 解析失败：' + e.message);
  }
}

// 根据 schema 的单个属性定义生成示例值（enum 取首项，无 enum 按类型取默认值）
function sampleValue(def) {
  if (!def || typeof def !== 'object') return '';
  if (Array.isArray(def.enum) && def.enum.length) return def.enum[0];
  if (def.default !== undefined) return def.default;
  switch (def.type) {
    case 'number':
    case 'integer': return 1;
    case 'boolean': return true;
    case 'array': return [];
    case 'object': return {};
    case 'string':
    default: return '';
  }
}

// 根据 OpenAPI 文档自动生成首个可调用操作的测试示例（operation + 路径/查询参数填默认值）
function buildOpenApiSample(doc) {
  if (!doc || !doc.paths || typeof doc.paths !== 'object') return null;
  const methods = ['get', 'post', 'put', 'delete', 'patch'];
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const method of methods) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;
      const opId = op.operationId || `${method}_${String(path).replace(/[^\w]/g, '_')}`;
      const sample = { operation: opId };
      const params = Array.isArray(op.parameters) ? op.parameters : [];
      for (const p of params) {
        if (p.in !== 'path' && p.in !== 'query') continue;
        sample[p.name] = p.example !== undefined ? p.example : sampleValue(p.schema || {});
      }
      return sample;
    }
  }
  return null;
}

// 模板里用 computed 返回 placeholder，避免在属性里嵌套 JSON 字符串字面量引发引号解析歧义。
// 依据当前测试技能的入参 schema（function）或 OpenAPI 文档（openapi）生成可直接复制的入参示例。
const testDialogPlaceholder = computed(() => {
  if (testDialog.type === 'openapi') {
    const sample = buildOpenApiSample(testDialog.schema);
    if (sample) return JSON.stringify(sample);
    return JSON.stringify({ operation: 'searchByName', name: 'china' });
  }
  const props = (testDialog.schema && testDialog.schema.properties) || {};
  const sample = {};
  for (const key of Object.keys(props)) {
    sample[key] = sampleValue(props[key]);
  }
  return JSON.stringify(sample);
});

async function load() {
  loading.value = true;
  try {
    list.value = await listSkills();
  } catch (e) {
    ElMessage.error('加载技能列表失败：' + (e?.message || e));
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(createForm, {
    name: '',
    type: 'function',
    description: '',
    sourceCode: '',
    openapiSchemaText: '',
    schemaJsonText: '',
    maxDuration: 2000,
  });
  createDialog.visible = true;
}

async function saveCreate() {
  if (!createForm.name.trim()) {
    ElMessage.warning('请填写名称');
    return;
  }
  saving.value = true;
  try {
    const payload = {
      name: createForm.name.trim(),
      type: createForm.type,
      description: createForm.description,
      status: 'active',
      securityPolicy: { maxDuration: createForm.maxDuration },
    };
    if (createForm.type === 'function') {
      if (!createForm.sourceCode.trim()) {
        ElMessage.warning('JS 函数技能必须提供函数代码');
        saving.value = false;
        return;
      }
      payload.sourceCode = createForm.sourceCode;
      payload.schemaJson = parseJsonOrNull(createForm.schemaJsonText, {});
    } else {
      if (!createForm.openapiSchemaText.trim()) {
        ElMessage.warning('OpenAPI 技能必须提供文档');
        saving.value = false;
        return;
      }
      payload.openapiSchema = parseJsonOrNull(createForm.openapiSchemaText, {});
    }
    await createSkill(payload);
    ElMessage.success('已创建');
    createDialog.visible = false;
    await load();
  } catch (e) {
    ElMessage.error('创建失败：' + (e?.message || e));
  } finally {
    saving.value = false;
  }
}

async function openEdit(row) {
  editDialog.visible = true;
  editDialog.id = row.id;
  editDialog.name = row.name;
  editDialog.type = row.type;
  editForm.type = row.type;
  try {
    const full = await getSkill(row.id);
    const v = full?.versions?.[0] || {};
    editDialog.version = v.version || 1;
    editForm.version = v.version || 1;
    editForm.name = full.name || row.name;
    editForm.description = full.description || '';
    editForm.active = full.status === 'active';
    editForm.sourceCode = v.sourceCode || '';
    editForm.openapiSchemaText = v.openapiSchema ? JSON.stringify(v.openapiSchema, null, 2) : '';
    editForm.maxDuration = (v.securityPolicy?.maxDuration) || 2000;
  } catch (e) {
    ElMessage.error('加载技能详情失败：' + (e?.message || e));
  }
}

async function saveMeta() {
  saving.value = true;
  try {
    await updateSkill(editDialog.id, {
      name: editForm.name,
      description: editForm.description,
      status: editForm.active ? 'active' : 'disabled',
    });
    ElMessage.success('元数据已保存');
    await load();
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || e));
  } finally {
    saving.value = false;
  }
}

async function saveNewVersion() {
  saving.value = true;
  try {
    const data = {
      securityPolicy: { maxDuration: editForm.maxDuration },
    };
    if (editForm.type === 'function') {
      data.sourceCode = editForm.sourceCode;
    } else {
      data.openapiSchema = parseJsonOrNull(editForm.openapiSchemaText, {});
    }
    await createSkillVersion(editDialog.id, data);
    ElMessage.success('已保存为新版本');
    editDialog.visible = false;
    await load();
  } catch (e) {
    ElMessage.error('保存版本失败：' + (e?.message || e));
  } finally {
    saving.value = false;
  }
}

async function removeIt(row) {
  try {
    await deleteSkill(row.id);
    ElMessage.success('已删除');
    await load();
  } catch (e) {
    ElMessage.error('删除失败：' + (e?.message || e));
  }
}

async function openTest(row) {
  // 先重置并立即展示弹窗，避免 await 阻塞用户感知
  Object.assign(testDialog, {
    visible: true,
    id: row.id,
    name: row.name,
    type: row.type,
    schema: null,
    inputText: '{}',
    running: false,
    result: null,
  });
  // 拉取技能详情，拿到最新版本后用 sampleValue 拼出示例，**直接预填到输入框**
  // （不只设 placeholder，因为 el-input 的 placeholder 在有值时不显示）
  try {
    const full = await getSkill(row.id);
    const v = full?.versions?.[0] || {};
    if (row.type === 'openapi') {
      const doc = v.openapiSchema || null;
      testDialog.schema = doc; // schema 字段复用承载 openapi 文档，供 placeholder 兜底
      const sample = buildOpenApiSample(doc);
      if (sample) testDialog.inputText = JSON.stringify(sample, null, 2);
    } else {
      const schema = v.schemaJson || null;
      testDialog.schema = schema;
      const props = schema && schema.properties;
      if (props && Object.keys(props).length) {
        const sample = {};
        for (const key of Object.keys(props)) {
          sample[key] = sampleValue(props[key]);
        }
        testDialog.inputText = JSON.stringify(sample, null, 2);
      }
    }
  } catch {
    testDialog.schema = null;
  }
}

async function runTest() {
  testDialog.running = true;
  try {
    let input = {};
    try {
      input = parseJsonOrNull(testDialog.inputText, {});
    } catch (e) {
      ElMessage.error(e.message);
      testDialog.running = false;
      return;
    }
    const data = await testSkill(testDialog.id, { input });
    testDialog.result = {
      status: data?.status || (data?.success ? 'success' : 'failed'),
      durationMs: data?.durationMs,
      output: data?.output,
      error: data?.error,
    };
  } catch (e) {
    testDialog.result = { status: 'failed', durationMs: 0, output: null, error: e?.message || String(e) };
  } finally {
    testDialog.running = false;
  }
}

onMounted(load);
</script>

<style scoped>
.skill-list { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.code-area :deep(textarea) {
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.5;
}
.test-result {
  width: 100%;
  border: 1px solid #dcdfe6;
  border-radius: 6px;
  overflow: hidden;
}
.test-result.success { border-color: #67c23a; }
.test-result.failed { border-color: #f56c6c; }
.test-meta { padding: 6px 10px; background: #f5f7fa; font-size: 12px; color: #606266; }
.test-output { margin: 0; padding: 10px; max-height: 240px; overflow: auto; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
</style>
