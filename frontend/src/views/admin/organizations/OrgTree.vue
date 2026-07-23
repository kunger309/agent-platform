<template>
  <div class="page">
    <h2 class="page-title">组织管理</h2>

    <el-row :gutter="16">
      <el-col :xs="24" :md="10">
        <el-card shadow="never">
          <template #header>
            <div class="card-hd">
              <span><el-icon><OfficeBuilding /></el-icon> 组织树</span>
              <el-button type="primary" size="small" :icon="Plus" @click="addRoot">新建根组织</el-button>
            </div>
          </template>
          <el-input v-model="keyword" placeholder="搜索组织名" clearable style="margin-bottom: 8px" />
          <el-tree
            ref="treeRef"
            :data="tree"
            :props="treeProps"
            node-key="id"
            :default-expand-all="expandOnLoad"
            :expand-on-click-node="false"
            highlight-current
            :filter-node-method="filterNode"
            @node-click="onSelect"
          >
            <template #default="{ data }">
              <span class="tree-node">
                <span class="tree-label">{{ data.name }}</span>
                <el-button
                  link
                  type="primary"
                  size="small"
                  :icon="Plus"
                  title="在此节点下新建子组织"
                  class="add-child-btn"
                  @click.stop="addChild(data)"
                />
              </span>
            </template>
          </el-tree>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header><span>组织详情</span></template>
          <el-empty v-if="!current" description="请选择左侧组织" />
          <el-form v-else label-width="100px">
            <el-form-item label="组织名">
              <el-input v-model="current.name" placeholder="组织名称" />
            </el-form-item>
            <el-form-item label="编码">
              <el-input v-model="current.code" placeholder="组织编码（唯一）" />
            </el-form-item>
            <el-form-item label="父组织">
              <el-tree-select
                v-model="current.parentId"
                :data="parentOptions"
                :props="treeProps"
                node-key="id"
                check-strictly
                clearable
                placeholder="（顶级组织）"
                style="width:100%"
              />
              <div class="hint">选择「顶级组织」或清空即为根组织；选择节点后保存会自动重算整棵子树</div>
            </el-form-item>
            <el-form-item label="排序">
              <el-input-number v-model="current.sort" :min="0" />
            </el-form-item>
            <el-form-item label="状态">
              <el-radio-group v-model="current.status">
                <el-radio value="active">启用</el-radio>
                <el-radio value="disabled">禁用</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="save">保存</el-button>
              <el-button type="danger" :disabled="current.code === 'ROOT'" @click="del">删除</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { OfficeBuilding, Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { listOrganizations, createOrganization, updateOrganization, deleteOrganization } from '@/api';

const treeProps = { label: 'name', value: 'id', children: 'children' };
const TOP_SENTINEL = '__TOP__'; // 合成顶级选项的 id（保存时映射回 null）

const tree = ref([]);
const current = ref(null);
const keyword = ref('');
const treeRef = ref(null);
const expandOnLoad = ref(true); // 首次加载展开，之后由用户/筛选控制

async function loadTree() {
  try {
    const data = await listOrganizations();
    tree.value = data?.tree || data || [];
    expandOnLoad.value = false; // 之后不强制全展开
  } catch (e) {
    ElMessage.warning('组织树加载失败');
    tree.value = [];
  }
}

function onSelect(node) {
  // 浅拷贝一份，编辑 form 不会直接改树里的节点
  current.value = { ...node };
}

/** 树选下拉：顶级 + 整棵树 */
const parentOptions = computed(() => [
  { id: TOP_SENTINEL, name: '（顶级组织）', children: tree.value },
]);

// 关键字筛选
watch(keyword, (kw) => {
  treeRef.value?.filter(kw);
});
function filterNode(query, data) {
  if (!query) return true;
  return data.name?.includes(query);
}

async function addRoot() {
  await createOrganization({
    name: '新组织',
    code: 'ORG_' + Date.now(),
    parentId: null,
    sort: 0,
    status: 'active',
  });
  ElMessage.success('已创建根组织');
  await loadTree();
}

/** 在指定节点下新建子组织 */
async function addChild(parentNode) {
  try {
    const created = await createOrganization({
      name: '新组织',
      code: 'ORG_' + Date.now(),
      parentId: parentNode.id,
      sort: 0,
      status: 'active',
    });
    ElMessage.success(`已在「${parentNode.name}」下创建子组织`);
    await loadTree();
    // 自动选中新创建的节点（可选体验优化）
    if (created?.id) current.value = { ...created };
  } catch (e) {
    ElMessage.error(e?.message || '创建失败');
  }
}

async function save() {
  // 显式白名单，只发后端 UpdateOrganizationDto 接受的字段
  // 防止 id / path / level / createdAt / children 等附加字段触发 400
  const src = current.value || {};
  const payload = {
    name: src.name,
    code: src.code,
    parentId:
      src.parentId === TOP_SENTINEL || src.parentId === '' ? null : src.parentId,
    sort: typeof src.sort === 'number' ? src.sort : 0,
    status: src.status || 'active',
  };
  if (src.description !== undefined) payload.description = src.description;
  await updateOrganization(src.id, payload);
  ElMessage.success('保存成功');
  await loadTree();
  // 重新选中当前节点
  if (src.id) {
    const node = findNode(tree.value, src.id);
    if (node) current.value = { ...node };
  }
}

async function del() {
  try {
    await ElMessageBox.confirm(`确定删除组织「${current.value.name}」？若有子组织或绑定的用户将禁止删除`, '确认删除', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await deleteOrganization(current.value.id);
    ElMessage.success('删除成功');
    current.value = null;
    await loadTree();
  } catch (e) {
    ElMessage.error(e?.message || '删除失败');
  }
}

function findNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    const c = findNode(n.children || [], id);
    if (c) return c;
  }
  return null;
}

onMounted(loadTree);
</script>

<style scoped>
.page-title { margin: 0 0 16px; font-weight: 600; }
.card-hd { display: flex; justify-content: space-between; align-items: center; }
.tree-node {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
  gap: 8px;
}
.tree-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.add-child-btn { padding: 0 4px; opacity: 0.7; }
.add-child-btn:hover { opacity: 1; }
.hint { font-size: 12px; color: #909399; margin-top: 4px; line-height: 1.4; }
</style>