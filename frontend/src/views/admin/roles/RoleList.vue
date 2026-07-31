<template>
  <div class="page">
    <h2 class="page-title">角色管理</h2>

    <el-card shadow="never">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索角色名/编码" clearable style="width: 240px" />
        <el-button type="primary" :icon="Plus" style="margin-left: auto" @click="openCreate">新建角色</el-button>
      </div>

      <el-table :data="filtered" v-loading="loading" border stripe style="margin-top: 16px">
        <el-table-column prop="code" label="编码" width="170" />
        <el-table-column prop="name" label="名称" width="150" />
        <el-table-column label="继承自" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.parentName" size="small" type="warning" effect="plain">
              {{ row.parentName }}
            </el-tag>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="160" />
        <el-table-column label="权限数" width="140">
          <template #default="{ row }">
            <span>{{ row.permissionCodes?.length || 0 }}</span>
            <span
              v-if="inheritedCount(row) > 0"
              class="inherit-badge"
              :title="`继承自上级的额外权限 ${inheritedCount(row)} 个`"
            >+{{ inheritedCount(row) }} 继承</span>
          </template>
        </el-table-column>
        <el-table-column label="数据范围" width="130">
          <template #default="{ row }">
            <el-tag size="small">{{ dataScopeLabel(row.dataScope) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="内置" width="70">
          <template #default="{ row }">
            <el-tag v-if="row.isBuiltin" type="info" size="small">内置</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link @click="openPerm(row)">分配权限</el-button>
            <el-button type="primary" link @click="openField(row)">字段权限</el-button>
            <el-button type="primary" link :disabled="row.isBuiltin" @click="openEdit(row)">编辑</el-button>
            <el-button type="danger" link :disabled="row.isBuiltin" @click="del(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建 / 编辑 -->
    <el-dialog v-model="dialog.visible" :title="dialog.id ? '编辑角色' : '新建角色'" width="540px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="编码"><el-input v-model="form.code" :disabled="!!dialog.id" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="2" /></el-form-item>
        <el-form-item label="继承自">
          <el-select v-model="form.parentId" clearable placeholder="不继承（独立角色）" style="width: 100%">
            <el-option
              v-for="r in parentOptions"
              :key="r.id"
              :label="`${r.name}（${r.code}）`"
              :value="r.id"
            />
          </el-select>
          <div class="tip">
            子角色自动拥有父角色的全部权限，无需重复勾选。禁止形成继承环，父角色被继承时不可删除。
          </div>
        </el-form-item>
        <el-form-item label="数据范围">
          <el-select v-model="form.dataScope" style="width: 100%">
            <el-option v-for="o in dataScopeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分配权限 -->
    <el-dialog v-model="permDialog.visible" :title="`分配权限 - ${currentRole?.name}`" width="680px">
      <el-alert
        v-if="currentRole?.parentName"
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 12px"
        :title="`该角色继承自「${currentRole.parentName}」`"
        :description="`下方只需勾选本角色额外需要的权限；继承来的 ${inheritedCount(currentRole)} 个权限会自动生效。`"
      />
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

    <!-- 字段级权限 -->
    <el-dialog v-model="fieldDialog.visible" :title="`字段权限 - ${currentRole?.name}`" width="640px">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 14px"
        title="按字段控制接口返回内容"
        description="可见=原样返回；脱敏=中间字符替换为 *；隐藏=从响应中彻底移除该字段。超级管理员不受限制；一个用户有多个角色时取最宽松的策略。"
      />
      <div v-loading="fieldDialog.loading">
        <div v-for="res in resources" :key="res.resource" class="res-block">
          <div class="res-title">{{ res.label }} <span class="mono muted">{{ res.resource }}</span></div>
          <div v-for="f in res.fields" :key="f.field" class="field-row">
            <div class="field-name">
              {{ f.label }} <span class="mono muted">{{ f.field }}</span>
            </div>
            <el-radio-group v-model="fieldState[`${res.resource}::${f.field}`]" size="small">
              <el-radio-button value="visible">可见</el-radio-button>
              <el-radio-button value="masked">脱敏</el-radio-button>
              <el-radio-button value="hidden">隐藏</el-radio-button>
            </el-radio-group>
          </div>
        </div>
        <el-empty v-if="!resources.length" description="暂无可配置的资源" />
      </div>
      <template #footer>
        <el-button @click="fieldDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="fieldDialog.saving" @click="saveFields">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  listRoles, createRole, updateRole, deleteRole,
  listPermissions, assignPermissions,
  listMaskableResources, listFieldPermissions, setFieldPermissions,
} from '@/api';

const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const permTree = ref([]);
const keyword = ref('');

const dialog = reactive({ visible: false, id: null });
const form = reactive({ code: '', name: '', description: '', dataScope: 'ORG', parentId: '' });

const permDialog = reactive({ visible: false });
const currentRole = ref(null);
const permTreeRef = ref(null);

const fieldDialog = reactive({ visible: false, loading: false, saving: false });
const resources = ref([]);
const fieldState = reactive({});

const dataScopeOptions = [
  { value: 'ALL', label: '全部' },
  { value: 'ORG_AND_CHILDREN', label: '本组织及下级' },
  { value: 'ORG', label: '本组织' },
  { value: 'SELF', label: '仅本人' },
];

function dataScopeLabel(v) { return dataScopeOptions.find((o) => o.value === v)?.label || v; }

const filtered = computed(() => {
  const kw = keyword.value.trim();
  if (!kw) return list.value;
  return list.value.filter((r) => (r.name || '').includes(kw) || (r.code || '').includes(kw));
});

/** 父角色候选：排除自己（避免自继承）。深层环由后端 assertNoRoleCycle 兜底 */
const parentOptions = computed(() => list.value.filter((r) => r.id !== dialog.id));

/** 继承带来的额外权限数量 = 有效权限 - 自身权限 */
function inheritedCount(row) {
  if (!row) return 0;
  const own = row.permissionCodes?.length || 0;
  const eff = row.effectivePermissionCodes?.length || 0;
  return Math.max(0, eff - own);
}

async function loadList() {
  loading.value = true;
  try {
    const data = await listRoles();
    list.value = (Array.isArray(data) ? data : data?.items || []).map((r) => ({
      ...r,
      permissionCodes: Array.isArray(r.permissionCodes) ? r.permissionCodes : [],
      effectivePermissionCodes: Array.isArray(r.effectivePermissionCodes) ? r.effectivePermissionCodes : [],
    }));
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
    const d = data || {};
    permTree.value = [...(d.menuTree || []), ...(d.buttonList || []), ...(d.apiList || [])];
  } catch (e) { permTree.value = []; }
}

function openCreate() {
  dialog.id = null;
  Object.assign(form, { code: '', name: '', description: '', dataScope: 'ORG', parentId: '' });
  dialog.visible = true;
}

function openEdit(row) {
  dialog.id = row.id;
  Object.assign(form, {
    code: row.code || '',
    name: row.name || '',
    description: row.description || '',
    dataScope: row.dataScope || 'ORG',
    parentId: row.parentId || '',
  });
  dialog.visible = true;
}

async function save() {
  saving.value = true;
  try {
    // parentId 三态：新建时空串→不提交；编辑时空串→显式解除继承
    const payload = {
      name: form.name,
      description: form.description,
      dataScope: form.dataScope,
    };
    if (dialog.id) {
      payload.parentId = form.parentId || '';
      await updateRole(dialog.id, payload);
    } else {
      payload.code = form.code;
      if (form.parentId) payload.parentId = form.parentId;
      await createRole(payload);
    }
    ElMessage.success('保存成功');
    dialog.visible = false;
    loadList();
  } catch (e) {
    ElMessage.error(e?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function del(row) {
  await ElMessageBox.confirm(`确认删除角色 ${row.name}？`, '提示', { type: 'warning' });
  try {
    await deleteRole(row.id);
    ElMessage.success('删除成功');
    loadList();
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

async function openPerm(row) {
  currentRole.value = row;
  permDialog.visible = true;
  await loadPerms();
  setTimeout(() => {
    if (permTreeRef.value) {
      permTreeRef.value.setCheckedKeys(row.permissionCodes || []);
    }
  }, 100);
}

async function savePerms() {
  const keys = permTreeRef.value.getCheckedKeys().concat(permTreeRef.value.getHalfCheckedKeys());
  await assignPermissions(currentRole.value.id, { permissionCodes: keys });
  ElMessage.success('权限已更新');
  permDialog.visible = false;
  loadList();
}

/* ---------- 字段级权限 ---------- */

async function loadResources() {
  try {
    const data = await listMaskableResources();
    resources.value = Array.isArray(data) ? data : [];
  } catch { resources.value = []; }
}

async function openField(row) {
  currentRole.value = row;
  fieldDialog.visible = true;
  fieldDialog.loading = true;
  try {
    if (!resources.value.length) await loadResources();
    // 先全部重置为 visible（未配置 = 可见）
    Object.keys(fieldState).forEach((k) => delete fieldState[k]);
    resources.value.forEach((res) => {
      res.fields.forEach((f) => { fieldState[`${res.resource}::${f.field}`] = 'visible'; });
    });
    const saved = await listFieldPermissions(row.id);
    (Array.isArray(saved) ? saved : []).forEach((it) => {
      fieldState[`${it.resource}::${it.field}`] = it.access;
    });
  } catch (e) {
    ElMessage.warning('字段权限加载失败');
  } finally {
    fieldDialog.loading = false;
  }
}

async function saveFields() {
  fieldDialog.saving = true;
  try {
    // 只提交非 visible 的条目，减少无意义落库
    const items = Object.entries(fieldState)
      .filter(([, access]) => access && access !== 'visible')
      .map(([key, access]) => {
        const [resource, field] = key.split('::');
        return { resource, field, access };
      });
    await setFieldPermissions(currentRole.value.id, items);
    ElMessage.success(items.length ? `已保存 ${items.length} 条字段策略` : '已清空字段策略');
    fieldDialog.visible = false;
  } catch (e) {
    ElMessage.error(e?.message || '保存失败');
  } finally {
    fieldDialog.saving = false;
  }
}

onMounted(() => { loadList(); loadPerms(); loadResources(); });
</script>

<style scoped>
.page-title { margin: 0 0 16px; font-weight: 600; }
.toolbar { display: flex; align-items: center; }
.muted { color: var(--el-text-color-placeholder); }
.mono {
  font-family: 'Microsoft YaHei', 'PingFang SC', 'JetBrains Mono', Consolas, monospace;
  font-size: 12px; letter-spacing: 0.3px;
}
.tip { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; margin-top: 4px; }
.inherit-badge {
  margin-left: 6px; font-size: 12px;
  color: var(--el-color-warning);
}
.res-block { margin-bottom: 18px; }
.res-title {
  font-weight: 600; font-size: 13px; margin-bottom: 8px;
  padding-bottom: 6px; border-bottom: 1px solid var(--el-border-color-lighter);
}
.field-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 0;
}
.field-name { font-size: 13px; }
</style>
