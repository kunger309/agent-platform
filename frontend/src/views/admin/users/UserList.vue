<template>
  <div class="page page-container">
    <h2>用户管理</h2>

    <div class="table-card">
    <div class="toolbar">
      <el-input v-model="query.keyword" placeholder="搜索用户名/姓名/邮箱" clearable style="width: 240px" @change="loadList" />
      <el-select v-model="query.status" placeholder="状态" clearable style="width: 140px" @change="loadList">
        <el-option label="启用" value="active" />
        <el-option label="禁用" value="disabled" />
        <el-option label="锁定" value="locked" />
      </el-select>
      <el-button type="primary" :icon="Plus" style="margin-left: auto" @click="openCreate">新建用户</el-button>
    </div>

    <el-table :data="list" v-loading="loading" border stripe style="margin-top: 16px">
        <el-table-column prop="username" label="用户名" width="140" />
        <el-table-column prop="name" label="姓名" width="140" />
        <el-table-column prop="email" label="邮箱" />
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
import { ref, reactive, onMounted } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listUsers, createUser, updateUser, deleteUser, resetPassword, listRoles } from '@/api';

const list = ref([]);
const total = ref(0);
const loading = ref(false);
const roles = ref([]);

const query = reactive({ keyword: '', status: '', page: 1, pageSize: 10 });

const dialog = reactive({ visible: false, id: null, saving: false });
const formRef = ref(null);
const form = reactive({ username: '', name: '', email: '', password: '', roleCodes: [], status: 'active' });
const rules = {
  username: [{ required: true, message: '请输入用户名' }],
  name: [{ required: true, message: '请输入姓名' }],
  email: [{ type: 'email', message: '邮箱格式不正确' }],
};

async function loadList() {
  loading.value = true;
  try {
    const data = await listUsers({ ...query });
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

function openCreate() {
  dialog.id = null;
  Object.assign(form, { username: '', name: '', email: '', password: '', roleCodes: ['viewer'], status: 'active' });
  dialog.visible = true;
}

function openEdit(row) {
  dialog.id = row.id;
  Object.assign(form, {
    username: row.username, name: row.name, email: row.email,
    roleCodes: row.roles || [], status: row.status || 'active',
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
      // 编辑时不传 password
      const payload = { name: form.name, email: form.email, status: form.status, roleCodes: form.roleCodes };
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

onMounted(() => { loadRoles(); loadList(); });
</script>

<style scoped>
.page-title { margin: 0 0 16px; font-weight: 600; }
.toolbar { display: flex; align-items: center; }
</style>
