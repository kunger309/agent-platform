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
          <el-input v-model="form.systemPrompt" type="textarea" :rows="4" placeholder="如：你是一个友好的客服助手" />
          <div class="prompt-helper">
            <el-button link size="small" type="primary" @click="regeneratePromptFromSkills">
              <el-icon><MagicStick /></el-icon>
              根据已绑技能生成提示词
            </el-button>
            <span class="hint">自动追加「遇到 X 场景请主动调用工具 Y」指引</span>
          </div>
        </el-form-item>
        <el-form-item label="温度">
          <el-slider v-model="form.temperature" :min="0" :max="2" :step="0.1" show-input />
        </el-form-item>
        <el-form-item label="绑定技能">
          <el-select
            v-model="form.skillIds"
            multiple
            filterable
            placeholder="为智能体挂载可调用的自定义技能（可选）"
            style="width: 100%"
          >
            <el-option
              v-for="s in skills"
              :key="s.id"
              :label="`${s.name}（${s.type === 'function' ? 'JS' : 'OpenAPI'}）`"
              :value="s.id"
            />
          </el-select>
          <div class="form-tip">绑定后，对话中会按需自动调用这些技能（function 沙箱 / OpenAPI 请求）。</div>
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
import { Plus, MagicStick } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { listProviders, PROVIDER_TYPES } from '@/api/provider';
import { listAgents, getAgent, createAgent, updateAgent, deleteAgent } from '@/api/agent';
import { listSkills, getAgentSkills, setAgentSkills } from '@/api/skills';

const router = useRouter();
const list = ref([]);
const providers = ref([]);
const skills = ref([]); // 全部技能（用于编辑时绑定）
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
  skillIds: [],
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

/** 用户点击「根据已绑技能生成提示词」：保留原前缀（去掉之前追加的工具段），重新生成 */
function regeneratePromptFromSkills() {
  const prev = (form.systemPrompt || '').split(/\n\n# 工具调用指引（必须遵守）/)[0];
  applySkillPrompt(prev);
}

async function load() {
  loading.value = true;
  try {
    [list.value, providers.value, skills.value] = await Promise.all([
      listAgents(),
      listProviders(),
      listSkills().catch(() => []),
    ]);
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
    systemPrompt: '',
    temperature: 0.7,
    skillIds: [],
  });
  // 默认 systemPrompt：基础人设 + 按当前已绑技能自动补「主动调用工具」段落
  applySkillPrompt('');
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
    // 读取已绑定的技能（AgentSkill 关联）
    let bound = [];
    try {
      bound = await getAgentSkills(row.id);
    } catch {
      bound = [];
    }
    Object.assign(form, {
      name: detail.name ?? row.name ?? '',
      type: detail.type ?? row.type ?? 'chat',
      description: detail.description ?? row.description ?? '',
      providerId: config.providerId ?? '',
      model: config.model ?? '',
      systemPrompt: detail.systemPrompt ?? '',
      temperature: typeof config.temperature === 'number' ? config.temperature : 0.7,
      skillIds: (bound || []).map((s) => s.skillId),
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
    let agentId = dialog.id;
    if (dialog.editing) {
      await updateAgent(dialog.id, payload);
    } else {
      const created = await createAgent(payload);
      agentId = created?.id || created?.data?.id;
    }
    // 同步技能绑定（全量替换语义）
    if (agentId) {
      try {
        await setAgentSkills(
          agentId,
          (form.skillIds || []).map((id) => ({ skillId: id, enabled: true })),
        );
      } catch (e) {
        ElMessage.warning('智能体已保存，但技能绑定失败：' + (e?.message || e));
      }
    }
    ElMessage.success('已保存');
    dialog.visible = false;
    await load();
  } finally {
    saving.value = false;
  }
}

/**
 * 生成 systemPrompt：基础人设 + 「主动调用工具」段（按 form.skillIds 拼接）。
 * - prevBase：保留用户已写的前缀（如「你是XX角色」），我们在后面追加工具段
 * - 流程：取 prevBase + 技能列表推导的调用指引；如果无技能则只保留 prevBase
 */
function applySkillPrompt(prevBase) {
  const base = (prevBase ?? '').trim() || '你是一个专业、友好的 AI 助手。请用简洁准确的中文回答用户问题。';
  const ids = form.skillIds || [];
  if (!ids.length) {
    form.systemPrompt = base;
    return;
  }
  const lines = ids
    .map((id) => skills.value.find((s) => s.id === id))
    .filter(Boolean)
    .map((s) => {
      const hint = pickSkillHint(s);
      return `- 当用户问题涉及「${hint}」时，请主动调用工具 \`${s.name}\`（可用输入参数见技能定义）。`;
    });
  if (!lines.length) {
    form.systemPrompt = base;
    return;
  }
  form.systemPrompt =
    base +
    '\n\n# 工具调用指引（必须遵守）\n' +
    '你已绑定以下自定义技能，遇到对应场景必须主动调用，不要凭记忆回答：\n' +
    lines.join('\n');
}

// 为常见技能起名生成"触发场景"提示；自定义技能回退到 description 第一行
const HINT_DICT = [
  { match: /计算|计算器|calc/i, hint: '数学计算、表达式求值' },
  { match: /时间|now|date/i, hint: '需要当前日期/时间' },
  { match: /天气|weather/i, hint: '查询天气、温度' },
  { match: /翻译|translate/i, hint: '跨语言翻译' },
  { match: /搜索|search/i, hint: '信息检索、查询' },
  { match: /文本|summary|统计|analy/i, hint: '文本分析、字数/词数/行数统计' },
];
function pickSkillHint(skill) {
  for (const r of HINT_DICT) if (r.match.test(skill.name) || r.match.test(skill.description || '')) return r.hint;
  if (skill.description) return skill.description.split(/[，。.\n]/)[0].trim().slice(0, 30) || skill.name;
  return skill.name;
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
.form-tip { font-size: 11px; color: #9ca3af; line-height: 1.4; margin-top: 4px; }
.prompt-helper { margin-top: 4px; display: flex; align-items: center; gap: 8px; }
.prompt-helper .hint { font-size: 12px; color: #909399; }
</style>