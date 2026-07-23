<template>
  <div class="page page-container user-mgmt">
    <!-- 左侧组织树 -->
    <div class="org-side">
      <div class="org-side__header">
        <span>组织</span>
        <el-button text size="small" type="primary" @click="onOrgClear">全部</el-button>
      </div>
      <el-scrollbar class="org-side__body">
        <el-tree
          ref="orgTreeRef"
          :data="orgTree"
          :props="{ label: 'name', children: 'children' }"
          node-key="id"
          :expand-on-click-node="false"
          highlight-current
          default-expand-all
          @node-click="onOrgClick"
        >
          <template #default="{ node }">
            <span class="org-node">{{ node.label }}</span>
          </template>
        </el-tree>
      </el-scrollbar>
    </div>

    <!-- 右侧用户表格 -->
    <div class="user-main">
      <h2>用户管理</h2>

      <div class="toolbar">
        <el-input v-model="query.keyword" placeholder="搜索用户名/姓名/邮箱" clearable style="width: 240px" @change="loadList" />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="loadList">
          <el-option label="启用" value="active" />
          <el-option label="禁用" value="disabled" />
          <el-option label="锁定" value="locked" />
        </el-select>
        <el-tag v-if="currentOrgName" closable type="info" style="margin-left: 8px" @close="onOrgClear">
          组织：{{ currentOrgName }}
        </el-tag>
        <el-button type="primary" :icon="Plus" style="margin-left: auto" @click="openCreate">新建用户</el-button>
      </div>

      <el-table :data="list" v-loading="loading" border stripe style="margin-top: 16px">
        <el-table-column prop="username" label="用户名" width="140" />
        <el-table-column prop="name" label="姓名" width="140" />
        <el-table-column prop="email" label="邮箱" />
        <el-table-column label="组织" min-width="160">
          <template #default="{ row }">
            <el-tag v-if="primaryOrg(row)" type="warning" size="small">{{ primaryOrg(row).name }}</el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="220">
          <template #default="{ row }">
            <el-tag v-for="r in row.roles" :key="r" type="success" size="small" style="margin-right: 4px">{{ r }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最后登录" width="160">
          <template #default="{ row }">{{ formatTime(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openEdit(row)">编辑</el-button>
            <el-button type="warning" link @click="resetPwd(row)">重置密码</el-button>
            <el-button type="danger" link :disabled="row.username === 'admin'" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        style="margin-top: 12px; justify-content: flex-end"
        @current-change="loadList"
        @size-change="loadList"
      />
    </div>

    <el-dialog v-model="dialog.visible" :title="dialog.id ? '编辑用户' : '新建用户'" width="540px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="!!dialog.id" />
        </el-form-item>
        <el-form-item label="姓名"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="邮箱" prop="email"><el-input v-model="form.email" /></el-form-item>
        <el-form-item v-if="!dialog.id" label="密码" prop="password"><el-input v-model="form.password" type="password" show-password /></el-form-item>
        <el-form-item label="组织">
          <el-tree-select
            v-model="form.organizationId"
            :data="orgTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            value-key="id"
            check-strictly
            :render-after-expand="false"
            clearable
            placeholder="请选择组织（可不选）"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.roleCodes" multiple style="width: 100%">
            <el-option v-for="r in roles" :key="r.code" :label="r.name" :value="r.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="active">启用</el-radio>
            <el-radio value="disabled">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="dialog.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  listRoles,
  listOrganizations,
} from '@/api';

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const roles = ref([]);
const orgTree = ref([]);
const orgTreeRef = ref(null);

const query = reactive({ keyword: '', status: '', page: 1, pageSize: 10, organizationId: null });

// 当前选中的组织（用于高亮 + 标签展示）
const currentOrgId = ref(null);
const currentOrgName = computed(() => {
  if (!currentOrgId.value) return '';
  return findOrg(orgTree.value, currentOrgId.value)?.name || '';
});

const dialog = reactive({ visible: false, id: null, saving: false });
const formRef = ref(null);
const form = reactive({
  username: '',
  name: '',
  email: '',
  password: '',
  roleCodes: [],
  status: 'active',
  organizationId: null,
});
const rules = {
  username: [{ required: true, message: '请输入用户名' }],
  name: [{ required: true, message: '请输入姓名' }],
  email: [{ type: 'email', message: '邮箱格式不正确' }],
};

function findOrg(nodes, id) {
  for (const n of nodes || []) {
    if (n.id === id) return n;
    const r = findOrg(n.children, id);
    if (r) return r;
  }
  return null;
}

async function loadOrgs() {
  try {
    const tree = await listOrganizations();
    orgTree.value = tree || [];
  } catch (e) {
    orgTree.value = [];
  }
}

async function loadList() {
  loading.value = true;
  try {
    const params = {
      keyword: query.keyword || undefined,
      status: query.status || undefined,
      organizationId: query.organizationId || undefined,
    };
    const data = await listUsers(params);
    list.value = data?.items || data || [];
    total.value = data?.total || list.value.length;
  } catch (e) {
    ElMessage.warning('用户列表加载失败（后端可能未实现 GET /users）');
    list.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadRoles() {
  try {
    const data = await listRoles();
    roles.value = data?.items || data || [];
  } catch (e) {
    roles.value = [];
  }
}

function onOrgClick(node) {
  currentOrgId.value = node.id;
  query.organizationId = node.id;
  query.page = 1;
  loadList();
}

function onOrgClear() {
  currentOrgId.value = null;
  query.organizationId = null;
  orgTreeRef.value?.setCurrentKey(null);
  loadList();
}

function primaryOrg(row) {
  if (!row.organizations || row.organizations.length === 0) return null;
  return row.organizations.find((o) => o.isPrimary) || row.organizations[0];
}

function openCreate() {
  dialog.id = null;
  Object.assign(form, {
    username: '',
    name: '',
    email: '',
    password: '',
    roleCodes: ['viewer'],
    status: 'active',
    organizationId: currentOrgId.value, // 在左侧选了组织时，默认归属该组织
  });
  dialog.visible = true;
}

function openEdit(row) {
  dialog.id = row.id;
  const po = primaryOrg(row);
  Object.assign(form, {
    username: row.username,
    name: row.name,
    email: row.email,
    roleCodes: row.roles || [],
    status: row.status || 'active',
    organizationId: po ? po.id : null,
  });
  dialog.visible = true;
}

async function save() {
  await formRef.value.validate();
  // 新建时本地校验密码（rules 已不强制，避免编辑时残留空值报错）
  if (!dialog.id && !form.password) {
    ElMessage.warning('请输入密码');
    return;
  }
  dialog.saving = true;
  try {
    if (dialog.id) {
      // 编辑时不传 password；organizationId 即使为 null 也显式下发以表达「解绑」
      const payload = {
        name: form.name,
        email: form.email,
        status: form.status,
        roleCodes: form.roleCodes,
        organizationId: form.organizationId ?? null,
      };
      await updateUser(dialog.id, payload);
    } else {
      await createUser({ ...form });
    }
    ElMessage.success('保存成功');
    dialog.visible = false;
    loadList();
  } catch (e) {
    ElMessage.error(e?.message || '保存失败');
  } finally {
    dialog.saving = false;
  }
}

async function resetPwd(row) {
  const { value } = await ElMessageBox.prompt('请输入新密码', '重置密码', { inputPattern: /.{6,}/, inputErrorMessage: '至少 6 位' });
  await resetPassword(row.id, value);
  ElMessage.success('重置成功');
}

async function del(row) {
  await ElMessageBox.confirm(`确认删除用户 ${row.username}？`, '提示', { type: 'warning' });
  await deleteUser(row.id);
  ElMessage.success('删除成功');
  loadList();
}

function statusLabel(s) { return { active: '启用', disabled: '禁用', locked: '锁定' }[s] || s; }
function statusType(s) { return { active: 'success', disabled: 'info', locked: 'danger' }[s] || ''; }
function formatTime(t) { return t ? new Date(t).toLocaleString() : '-'; }

onMounted(() => { loadRoles(); loadOrgs(); loadList(); });
</script>

<style scoped>
.user-mgmt {
  display: flex;
  gap: 16px;
  align-items: stretch;
}
.org-side {
  width: 240px;
  flex: 0 0 240px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  background: var(--el-bg-color);
  max-height: calc(100vh - 140px);
}
.org-side__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--el-border-color);
  font-weight: 600;
}
.org-side__body {
  flex: 1;
  padding: 8px;
}
.user-main {
  flex: 1;
  min-width: 0;
}
.muted {
  color: var(--el-text-color-secondary);
}
.org-node {
  font-size: 13px;
}
.page-title { margin: 0 0 16px; font-weight: 600; }
.toolbar { display: flex; align-items: center; }
</style>
