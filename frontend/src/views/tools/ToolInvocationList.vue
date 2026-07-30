<template>
  <div class="tool-invocation-list page-container">
    <div class="page-header">
      <h2>技能调用记录</h2>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="load(true)">刷新</el-button>
      </div>
    </div>

    <!-- 概览卡片 -->
    <div class="stat-cards" v-loading="statsLoading">
      <div class="stat-card">
        <div class="stat-value">{{ stats.totalLast7Days || 0 }}</div>
        <div class="stat-label">近 7 天调用次数</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-success">{{ stats.byStatus?.success || 0 }}</div>
        <div class="stat-label">成功</div>
      </div>
      <div class="stat-card">
        <div class="stat-value stat-failed">{{ stats.byStatus?.failed || 0 }}</div>
        <div class="stat-label">失败</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{{ topSkillCount }}</div>
        <div class="stat-label">调用技能数</div>
      </div>
    </div>

    <!-- 筛选区 -->
    <div class="filter-bar">
      <el-form inline :model="filters" @submit.prevent="load(true)">
        <el-form-item label="技能">
          <el-select v-model="filters.skillId" clearable filterable placeholder="全部技能" style="width: 180px" @change="load(true)">
            <el-option v-for="s in skills" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="智能体">
          <el-select v-model="filters.agentId" clearable filterable placeholder="全部智能体" style="width: 180px" @change="load(true)">
            <el-option v-for="a in agents" :key="a.id" :label="a.name" :value="a.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width: 120px" @change="load(true)">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failed" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间">
          <el-date-picker
            v-model="filters.dateRange"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DDTHH:mm:ss[Z]"
            style="width: 360px"
            @change="load(true)"
          />
        </el-form-item>
        <el-form-item>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 表格 -->
    <div class="table-card">
      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column label="技能" min-width="160">
          <template #default="{ row }">
            <span v-if="row.skill">{{ row.skill.name }}</span>
            <el-tag v-else type="info" size="small">已删除</el-tag>
            <el-tag v-if="row.skill" size="small" :type="row.skill.type === 'function' ? 'warning' : 'success'" effect="plain" style="margin-left: 6px">
              {{ row.skill.type === 'function' ? 'JS' : 'API' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="智能体" min-width="140">
          <template #default="{ row }">
            <span v-if="row.agent">{{ row.agent.name }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="调用人" width="140">
          <template #default="{ row }">
            <span v-if="row.user">{{ row.user.name || row.user.username }}</span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
              {{ row.status === 'success' ? '成功' : row.status === 'failed' ? '失败' : row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="100">
          <template #default="{ row }">
            <span :class="{ 'slow': row.durationMs > 1000 }">{{ row.durationMs ?? '-' }} ms</span>
          </template>
        </el-table-column>
        <el-table-column label="输入" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="snippet">{{ truncate(row.inputJson) }}</code>
          </template>
        </el-table-column>
        <el-table-column label="输出 / 错误" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <code v-if="row.status === 'success'" class="snippet">{{ truncate(row.outputJson) }}</code>
            <code v-else class="snippet error">{{ row.errorMessage || truncate(row.outputJson) }}</code>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无调用记录" />
        </template>
      </el-table>

      <div class="pagination-bar">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="load()"
          @size-change="load(true)"
        />
      </div>
    </div>

    <!-- 详情弹窗 -->
    <el-dialog v-model="detailDialog.visible" title="调用详情" width="720px" destroy-on-close>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="技能">{{ detailDialog.row?.skill?.name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="detailDialog.row?.status === 'success' ? 'success' : 'danger'" size="small">
            {{ detailDialog.row?.status }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="智能体">{{ detailDialog.row?.agent?.name || '-' }}</el-descriptions-item>
        <el-descriptions-item label="调用人">{{ detailDialog.row?.user?.name || detailDialog.row?.user?.username || '-' }}</el-descriptions-item>
        <el-descriptions-item label="耗时">{{ detailDialog.row?.durationMs ?? '-' }} ms</el-descriptions-item>
        <el-descriptions-item label="时间">{{ formatTime(detailDialog.row?.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="执行 ID" :span="2">
          <code class="snippet">{{ detailDialog.row?.executionId }}</code>
        </el-descriptions-item>
      </el-descriptions>
      <el-divider>输入参数</el-divider>
      <pre class="json-block">{{ formatJson(detailDialog.row?.inputJson) }}</pre>
      <el-divider>输出</el-divider>
      <pre class="json-block">{{ formatJson(detailDialog.row?.outputJson) }}</pre>
      <template v-if="detailDialog.row?.errorMessage">
        <el-divider>错误信息</el-divider>
        <pre class="json-block error">{{ detailDialog.row.errorMessage }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { listToolInvocations, getToolInvocationStats } from '@/api/tool-invocations';
import { listSkills } from '@/api/skills';
import { listAgents } from '@/api/agent';

const rows = ref([]);
const loading = ref(false);
const total = ref(0);
const skills = ref([]);
const agents = ref([]);

const stats = ref({});
const statsLoading = ref(false);
const topSkillCount = computed(() => (stats.value.topSkills?.length || 0));

const filters = reactive({
  skillId: '',
  agentId: '',
  status: '',
  dateRange: [],
});

const pagination = reactive({ page: 1, pageSize: 20 });

const detailDialog = reactive({ visible: false, row: null });

function formatTime(t) {
  return t ? new Date(t).toLocaleString('zh-CN') : '-';
}
function truncate(v) {
  if (v === undefined || v === null) return '-';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}
function formatJson(v) {
  if (v === undefined || v === null) return '(空)';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

async function load(resetPage = false) {
  if (resetPage) pagination.page = 1;
  loading.value = true;
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize,
    };
    if (filters.skillId) params.skillId = filters.skillId;
    if (filters.agentId) params.agentId = filters.agentId;
    if (filters.status) params.status = filters.status;
    if (Array.isArray(filters.dateRange) && filters.dateRange[0]) params.from = filters.dateRange[0];
    if (Array.isArray(filters.dateRange) && filters.dateRange[1]) params.to = filters.dateRange[1];
    // client.js 响应拦截器已对 { success, data } 自动 unwrap 到 body.data，直接拿到 { items, total }
    const body = await listToolInvocations(params);
    rows.value = body.items || [];
    total.value = body.total || 0;
  } catch (e) {
    ElMessage.error('加载调用记录失败：' + (e?.message || e));
  } finally {
    loading.value = false;
  }
}

async function loadStats() {
  statsLoading.value = true;
  try {
    // stats 同样：unwrap 后直接是 { totalLast7Days, topSkills, byStatus }
    stats.value = (await getToolInvocationStats()) || {};
  } catch {} finally { statsLoading.value = false; }
}

async function loadFilters() {
  try { skills.value = (await listSkills()) || []; } catch {}
  try { agents.value = (await listAgents()) || []; } catch {}
}

function resetFilters() {
  Object.assign(filters, { skillId: '', agentId: '', status: '', dateRange: [] });
  load(true);
}

function openDetail(row) {
  detailDialog.row = row;
  detailDialog.visible = true;
}

onMounted(() => {
  load(true);
  loadStats();
  loadFilters();
});
</script>

<style scoped>
.page-container { padding: 16px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.page-header h2 { margin: 0; font-size: 20px; font-weight: 600; }
.header-actions { display: flex; gap: 8px; }

.stat-cards {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;
}
.stat-card {
  background: #fff; border-radius: 8px; padding: 16px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
  text-align: center;
}
.stat-value { font-size: 26px; font-weight: 600; color: #303133; }
.stat-value.stat-success { color: #67c23a; }
.stat-value.stat-failed { color: #f56c6c; }
.stat-label { font-size: 12px; color: #909399; margin-top: 4px; }

.filter-bar { background: #fff; border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
.table-card { background: #fff; border-radius: 8px; padding: 16px; }
.text-muted { color: #c0c4cc; }
.snippet { font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace; font-size: 12px; color: #606266; }
.snippet.error { color: #f56c6c; }
.slow { color: #e6a23c; font-weight: 600; }
.pagination-bar { display: flex; justify-content: flex-end; margin-top: 12px; }
.json-block {
  font-family: 'JetBrains Mono', Consolas, 'Microsoft YaHei', monospace;
  font-size: 12px; background: #fafafa; border: 1px solid #ebeef5; border-radius: 4px;
  padding: 10px; max-height: 240px; overflow: auto; margin: 0; white-space: pre-wrap; word-break: break-all;
}
.json-block.error { color: #f56c6c; background: #fef0f0; }
</style>
