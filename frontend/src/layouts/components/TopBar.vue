<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const user = computed(() => userStore.user || {});

const roleLabel = computed(() => {
  const roles = user.value.roles || [];
  if (user.value.isSuperAdmin || roles.includes('super_admin')) return '超级管理员';
  if (roles.includes('admin')) return '管理员';
  if (roles.length === 0) return '普通用户';
  return roles[0];
});

const handleLogout = async () => {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', {
      type: 'warning',
    });
  } catch {
    return;
  }
  await userStore.logout();
  router.push('/login');
};

const goProfile = () => router.push('/profile');
</script>

<template>
  <div class="topbar">
    <div class="topbar-left">
      <span class="page-title">{{ $route.meta?.title || '' }}</span>
    </div>
    <div class="topbar-right">
      <el-dropdown trigger="click">
        <span class="user-info">
          <el-avatar :size="36" :src="user.avatar">
            {{ (user.name || user.username || 'U').charAt(0).toUpperCase() }}
          </el-avatar>
          <div class="user-text">
            <div class="user-name">{{ user.name || user.username || '未登录' }}</div>
            <div class="user-role">{{ roleLabel }}</div>
          </div>
          <el-icon class="caret"><ArrowDown /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="goProfile">
              <el-icon><User /></el-icon> 个人中心
            </el-dropdown-item>
            <el-dropdown-item divided @click="handleLogout">
              <el-icon><SwitchButton /></el-icon> 退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  height: var(--topbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #fff;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  letter-spacing: 0.3px;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 8px;
  transition: background 0.2s;
}
.user-info:hover { background: #f5f7fa; }
.user-text { display: flex; flex-direction: column; line-height: 1.25; }
.user-name {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}
.user-role {
  font-size: 12px;
  color: #909399;
}
.caret {
  color: #c0c4cc;
  font-size: 12px;
  transition: transform 0.2s;
}
:deep(.el-dropdown:hover) .caret { transform: rotate(180deg); }
</style>
