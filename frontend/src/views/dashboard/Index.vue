<template>
  <div class="dashboard">
    <h2 class="page-title">工作台</h2>
    <el-row :gutter="16">
      <el-col :xs="24" :sm="12" :md="6" v-for="card in cards" :key="card.title">
        <el-card shadow="hover" class="metric-card">
          <div class="metric-icon" :style="{ background: card.color }">
            <el-icon size="22"><component :is="card.icon" /></el-icon>
          </div>
          <div class="metric-info">
            <div class="metric-title">{{ card.title }}</div>
            <div class="metric-value">{{ card.value }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :xs="24" :md="14">
        <el-card shadow="hover">
          <template #header>
            <span><el-icon><Document /></el-icon> 系统介绍</span>
          </template>
          <p>本平台是基于 <b>NestJS + LangChain.js + LangGraph.js + Qdrant</b> 构建的 AI 智能体开发平台。</p>
          <ul>
            <li><b>聊天智能体</b>：基于 LangChain AgentExecutor，支持工具调用</li>
            <li><b>流程编排智能体</b>：基于 LangGraph StateGraph，可视化拖拽 DAG</li>
            <li><b>自定义 Skills</b>：OpenAPI / 自定义 JS 函数注册为 LangChain Tool</li>
            <li><b>知识库</b>：PDF / Word / Excel / PPT / Markdown / HTML / 图片 OCR</li>
            <li><b>完整 RBAC</b>：用户 / 组织 / 角色 / 用户权限 / 数据权限</li>
          </ul>
          <p><el-tag type="warning">Phase 1 MVP</el-tag> 当前仅完成基础框架 + 权限体系 + 登录</p>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="10">
        <el-card shadow="hover">
          <template #header>
            <span><el-icon><User /></el-icon> 账号信息</span>
          </template>
          <p><b>用户名</b>：{{ user.username }}</p>
          <p><b>昵称</b>：{{ user.nickname || '-' }}</p>
          <p><b>角色</b>：<el-tag v-for="r in user.roles" :key="r" type="success" size="small" style="margin-right: 6px">{{ r }}</el-tag></p>
          <p v-if="user.mustChangePassword">
            <el-tag type="danger">首登强制改密未完成</el-tag>
          </p>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { User, Document, ChatDotRound, Box, Reading } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const user = computed(() => userStore.profile || {});

const cards = [
  { title: '智能体', value: 0, icon: ChatDotRound, color: '#409EFF' },
  { title: '工作流', value: 0, icon: Box, color: '#67C23A' },
  { title: '知识库', value: 0, icon: Reading, color: '#E6A23C' },
  { title: 'Skills', value: 0, icon: Document, color: '#F56C6C' },
];
</script>

<style scoped>
.dashboard { padding: 0; }
.page-title { margin: 0 0 16px; font-weight: 600; }
.metric-card {
  display: flex;
  align-items: center;
  padding: 4px;
}
.metric-icon {
  width: 48px; height: 48px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  color: #fff; margin-right: 14px; flex-shrink: 0;
}
.metric-info { flex: 1; }
.metric-title { color: #909399; font-size: 13px; }
.metric-value { font-size: 22px; font-weight: 600; }
</style>
