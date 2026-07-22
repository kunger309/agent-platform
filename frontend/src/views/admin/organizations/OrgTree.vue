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
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            default-expand-all
            highlight-current
            @node-click="onSelect"
          />
        </el-card>
      </el-col>

      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header><span>组织详情</span></template>
          <el-empty v-if="!current" description="请选择左侧组织" />
          <el-form v-else label-width="100px">
            <el-form-item label="组织名"><el-input v-model="current.name" /></el-form-item>
            <el-form-item label="编码"><el-input v-model="current.code" /></el-form-item>
            <el-form-item label="父组织">
              <el-tag>{{ parentName || '（根组织）' }}</el-tag>
            </el-form-item>
            <el-form-item label="排序"><el-input-number v-model="current.sort" :min="0" /></el-form-item>
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
import { ref, computed, onMounted } from 'vue';
import { OfficeBuilding, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { listOrganizations, createOrganization, updateOrganization, deleteOrganization } from '@/api';

const tree = ref([]);
const current = ref(null);
const keyword = ref('');

async function loadTree() {
  try {
    const data = await listOrganizations({ tree: true });
    tree.value = data?.tree || data || [];
  } catch (e) {
    ElMessage.warning('组织树加载失败（后端可能未实现 GET /organizations?tree）');
    tree.value = [];
  }
}

function onSelect(node) { current.value = { ...node }; }

const parentName = computed(() => {
  if (!current.value?.parentId) return '';
  const find = (nodes) => {
    for (const n of nodes) {
      if (n.id === current.value.parentId) return n.name;
      const c = find(n.children || []); if (c) return c;
    }
    return null;
  };
  return find(tree.value);
});

async function addRoot() {
  await createOrganization({ name: '新组织', code: 'ORG_' + Date.now(), parentId: null, sort: 0, status: 'active' });
  ElMessage.success('已创建');
  loadTree();
}

async function save() {
  await updateOrganization(current.value.id, current.value);
  ElMessage.success('保存成功');
  loadTree();
}

async function del() {
  await deleteOrganization(current.value.id);
  ElMessage.success('删除成功');
  current.value = null;
  loadTree();
}

onMounted(loadTree);
</script>

<style scoped>
.page-title { margin: 0 0 16px; font-weight: 600; }
.card-hd { display: flex; justify-content: space-between; align-items: center; }
</style>
