<template>
  <div class="dashboard page-container">
    <div class="page-header">
      <h2>工作台</h2>
      <span class="welcome-hint">欢迎回来，{{ user.name || user.username }} · {{ orgName }}</span>
    </div>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="12" :md="6" v-for="card in cards" :key="card.key">
        <el-card shadow="hover" class="metric-card" @click.native="goTo(card.to)">
          <div class="metric-icon" :style="{ background: card.color }">
            <el-icon size="22"><component :is="card.icon" /></el-icon>
          </div>
          <div class="metric-info">
            <div class="metric-title">{{ card.title }}</div>
            <div class="metric-value">
              <span v-if="loading">···</span>
              <span v-else>{{ card.value }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :xs="24" :md="14">
        <el-card shadow="hover">
          <template #header>
            <span><el-icon><Document /></el-icon> 平台能力</span>
          </template>
          <p>本平台是基于 <b>NestJS + LangChain.js + LangGraph.js + Qdrant</b> 构建的 AI 智能体开发平台。</p>
          <ul class="feature-list">
            <li><b>聊天智能体</b>：LangChain AgentExecutor，支持工具调用、知识库注入、Markdown/附件多模态</li>
            <li><b>流程编排智能体</b>：LangGraph StateGraph，可视化拖拽 DAG，绑定已发布工作流</li>
            <li><b>自定义 Skills</b>：OpenAPI / 自定义 JS 函数注册为 LangChain Tool，支持版本与沙箱执行</li>
            <li><b>知识库</b>：PDF / Word / Excel / PPT / Markdown / HTML / 图片 OCR，向量+BM25 混合检索</li>
            <li><b>RBAC + 角色继承 + 字段级脱敏</b>：用户/组织/角色/权限/数据权限/MaskResource</li>
            <li><b>监控 + 对外 API</b>：Prometheus /metrics、/monitor/summary、Grafana 看板、API Key 生命周期管理</li>
            <li><b>性能优化</b>：embedding 缓存、检索去重、前端 SSE 断线重连（未出内容自动重试，已出内容提示用户手动重发）</li>
          </ul>
          <p>
            <el-tag type="success" size="small">已完成 Phase 1–5</el-tag>
            <el-tag type="info" size="small" style="margin-left: 6px">当前迭代：Phase 5（高级特性 / 监控 / 对外 API / 性能优化）</el-tag>
          </p>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="10">
        <el-card shadow="hover">
          <template #header>
            <span><el-icon><User /></el-icon> 账号信息</span>
          </template>
          <p><b>用户名</b>：{{ user.username || '-' }}</p>
          <p><b>昵称</b>：{{ user.name || '-' }}</p>
          <p><b>邮箱</b>：{{ user.email || '-' }}</p>
          <p><b>角色</b>：
            <el-tag v-for="r in user.roles || []" :key="r" type="success" size="small" style="margin-right: 6px">{{ r }}</el-tag>
          </p>
          <p><b>当前组织</b>：{{ orgName || '-' }}</p>
          <p v-if="user.mustChangePassword">
            <el-tag type="danger">首登强制改密未完成</el-tag>
          </p>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { User, Document, ChatDotRound, Box, Reading } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';
import { getDashboardStats } from '@/api/dashboard';

const router = useRouter();
const userStore = useUserStore();
const user = computed(() => userStore.user || {});

const loading = ref(false);
const stats = reactive({
  orgId: '',
  orgName: '',
  agents: 0,
  workflows: 0,
  knowledgeBases: 0,
  skills: 0,
  conversations: 0,
});

const orgName = computed(() => stats.orgName || userStore.currentOrg?.name || userStore.user?.currentOrgName || '');

const cards = computed(() => [
  { key: 'agents', title: '智能体', value: stats.agents, icon: ChatDotRound, color: '#409EFF', to: '/agents' },
  { key: 'workflows', title: '工作流', value: stats.workflows, icon: Box, color: '#67C23A', to: '/workflows' },
  { key: 'knowledgeBases', title: '知识库', value: stats.knowledgeBases, icon: Reading, color: '#E6A23C', to: '/knowledge-bases' },
  { key: 'skills', title: 'Skills', value: stats.skills, icon: Document, color: '#F56C6C', to: '/skills' },
]);

function goTo(path) {
  if (path) router.push(path);
}

onMounted(async () => {
  loading.value = true;
  try {
    const data = await getDashboardStats();
    if (data && typeof data === 'object') {
      Object.assign(stats, {
        orgId: data.orgId || '',
        orgName: data.orgName || '',
        agents: Number(data.agents) || 0,
        workflows: Number(data.workflows) || 0,
        knowledgeBases: Number(data.knowledgeBases) || 0,
        skills: Number(data.skills) || 0,
        conversations: Number(data.conversations) || 0,
      });
    }
  } catch (e) {
    // 静默失败，cards 保留 0
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.dashboard { padding: 0; }
.welcome-hint { color: #909399; font-size: 14px; }
.metric-card {
  display: flex;
  align-items: center;
  padding: 4px;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.metric-card:hover {
  transform: translateY(-2px);
}
.metric-icon {
  width: 48px; height: 48px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; margin-right: 14px; flex-shrink: 0;
}
.metric-info { flex: 1; }
.metric-title { color: #909399; font-size: 13px; }
.metric-value { font-size: 22px; font-weight: 600; min-height: 28px; }
.feature-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.9;
}
</style>