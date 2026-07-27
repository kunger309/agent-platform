<template>
  <div class="workflow-list page-container">
    <div class="page-header">
      <h2>工作流</h2>
      <el-button v-if="perm.has('workflow:create')" type="primary" :icon="Plus" @click="openCreate">
        新建工作流
      </el-button>
    </div>

    <div class="table-card">
      <el-table :data="list" v-loading="loading" stripe empty-text="暂无工作流">
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusColor(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="80" />
        <el-table-column prop="updatedAt" label="更新时间" width="180">
          <template #default="{ row }">{{ formatTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="perm.has('workflow:run')"
              size="small"
              type="primary"
              @click="goDebug(row)"
            >调试</el-button>
            <el-button
              v-if="perm.has('workflow:edit')"
              size="small"
              @click="goEdit(row)"
            >编排</el-button>
            <el-button
              v-if="perm.has('workflow:edit') && row.status !== 'published'"
              size="small"
              type="success"
              @click="publishIt(row)"
            >发布</el-button>
            <el-popconfirm
              v-if="perm.has('workflow:edit')"
              title="确认删除该工作流？"
              @confirm="removeIt(row)"
            >
              <template #reference>
                <el-button size="small" type="danger">删除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 新建弹窗 -->
    <el-dialog v-model="dialog.visible" title="新建工作流" width="520px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：智能客服分流" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="草稿" value="draft" />
            <el-option label="已发布" value="published" />
            <el-option label="归档" value="archived" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveIt">创建并编排</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { usePermission } from '@/composables/usePermission';
import {
  listWorkflows,
  createWorkflow,
  deleteWorkflow,
  publishWorkflow,
} from '@/api/workflows';

const router = useRouter();
const perm = usePermission();
const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const formRef = ref(null);

const dialog = reactive({ visible: false });
const form = reactive({ name: '', description: '', status: 'draft' });
const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
};

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
    list.value = await listWorkflows();
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  Object.assign(form, { name: '', description: '', status: 'draft' });
  dialog.visible = true;
}

async function saveIt() {
  await formRef.value.validate();
  saving.value = true;
  try {
    const wf = await createWorkflow({ ...form, graphJson: { nodes: [], edges: [] } });
    ElMessage.success('已创建');
    dialog.visible = false;
    router.push({ path: `/workflows/${wf.id}/edit`, query: { name: wf.name } });
  } finally {
    saving.value = false;
  }
}

function goEdit(row) {
  router.push({ path: `/workflows/${row.id}/edit`, query: { name: row.name } });
}
function goDebug(row) {
  router.push({ path: `/workflows/${row.id}/debug`, query: { name: row.name } });
}

async function publishIt(row) {
  try {
    await ElMessageBox.confirm(`确认发布「${row.name}」？将版本号 +1。`, '发布', {
      type: 'warning',
    });
  } catch {
    return;
  }
  await publishWorkflow(row.id);
  ElMessage.success('已发布');
  await load();
}

async function removeIt(row) {
  await deleteWorkflow(row.id);
  ElMessage.success('已删除');
  await load();
}

onMounted(load);
</script>

<style scoped>
.workflow-list { padding: 0; }
.page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-header h2 { margin: 0; font-weight: 600; }
</style>
