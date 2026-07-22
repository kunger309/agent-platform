<template>
  <div class="page">
    <h2 class="page-title">角色管理</h2>

    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索角色名/编码" clearable style="width: 240px" @change="loadList" />
        <el-button type="primary" :icon="Plus" style="margin-left: auto" @click="openCreate">新建角色</el-button>
      </div>

      <el-table :data="list" v-loading="loading" border stripe style="margin-top: 16px">
        <el-table-column prop="code" label="编码" width="180" />
        <el-table-column prop="name" label="名称" width="160" />
        <el-table-column prop="description" label="描述" />
        <el-table-column label="数据范围" width="140">
          <template #default="{ row }">
            <el-tag size="small">{{ dataScopeLabel(row.dataScope) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内置" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.isBuiltIn" type="info" size="small">内置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openPerm(row)">分配权限</el-button>
            <el-button type="primary" link :disabled="row.isBuiltIn" @click="openEdit(row)">编辑</el-button>
            <el-button type="danger" link :disabled="row.isBuiltIn" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog.visible" :title="dialog.id ? '编辑角色' : '新建角色'" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="编码"><el-input v-model="form.code" :disabled="!!dialog.id" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="form.dataScope" style="width: 100%">
            <el-option v-for="o in dataScopeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="permDialog.visible" :title="`分配权限 - ${currentRole?.name}`" width="640px">
      <el-tree
        ref="permTreeRef"
        :data="permTree"
        :props="{ label: 'name', children: 'children' }"
        show-checkbox
        node-key="code"
        default-expand-all
      />
      <template #footer>
        <el-button @click="permDialog.visible = false">取消</el-button>
        <el-button type="primary" @click="savePerms">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listRoles, createRole, updateRole, deleteRole, listPermissions, assignPermissions } from '@/api';

const list = ref([]);
const loading = ref(false);
const permTree = ref([]);
const keyword = ref('');

const dialog = reactive({ visible: false, id: null });
const form = reactive({ code: '', name: '', description: '', dataScope: 'ORG' });

const permDialog = reactive({ visible: false });
const currentRole = ref(null);
const permTreeRef = ref(null);

const dataScopeOptions = [
  { value: 'ALL', label: '全部' },
  { value: 'ORG_AND_CHILDREN', label: '本组织及下级' },
  { value: 'ORG', label: '本组织' },
  { value: 'SELF', label: '仅本人' },
];

function dataScopeLabel(v) { return dataScopeOptions.find((o) => o.value === v)?.label || v; }

async function loadList() {
  loading.value = true;
  try {
    const data = await listRoles();
    list.value = (data?.items || data || []).filter((r) => !keyword.value || r.name.includes(keyword.value) || r.code.includes(keyword.value));
  } catch (e) {
    ElMessage.warning('角色列表加载失败');
    list.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadPerms() {
  try {
    const data = await listPermissions({ tree: true });
    permTree.value = data?.tree || data || [];
  } catch (e) { permTree.value = []; }
}

function openCreate() {
  dialog.id = null;
  Object.assign(form, { code: '', name: '', description: '', dataScope: 'ORG' });
  dialog.visible = true;
}

function openEdit(row) {
  dialog.id = row.id;
  Object.assign(form, row);
  dialog.visible = true;
}

async function save() {
  if (dialog.id) await updateRole(dialog.id, form);
  else await createRole(form);
  ElMessage.success('保存成功');
  dialog.visible = false;
  loadList();
}

async function del(row) {
  await ElMessageBox.confirm(`确认删除角色 ${row.name}？`, '提示', { type: 'warning' });
  await deleteRole(row.id);
  ElMessage.success('删除成功');
  loadList();
}

async function openPerm(row) {
  currentRole.value = row;
  permDialog.visible = true;
  await loadPerms();
  // 选中已有权限（需要后端返回 role.permissions）
  setTimeout(() => {
    if (permTreeRef.value && row.permissions) {
      permTreeRef.value.setCheckedKeys(row.permissions);
    }
  }, 100);
}

async function savePerms() {
  const keys = permTreeRef.value.getCheckedKeys().concat(permTreeRef.value.getHalfCheckedKeys());
  await assignPermissions(currentRole.value.id, { permissionCodes: keys });
  ElMessage.success('权限已更新');
  permDialog.visible = false;
}

onMounted(() => { loadList(); loadPerms(); });
</script>

<style scoped>
.page-title { margin: 0 0 16px; font-weight: 600; }
.toolbar { display: flex; align-items: center; }
</style>
