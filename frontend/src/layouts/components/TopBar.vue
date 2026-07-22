<script setup>
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

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
      <el-dropdown>
        <span class="user-info">
          <el-avatar :size="32" :src="userStore.user?.avatar">
            {{ userStore.user?.name?.charAt(0) || 'U' }}
          </el-avatar>
          <span class="user-name">{{ userStore.user?.name || userStore.user?.username }}</span>
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
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.user-name {
  font-size: 14px;
  color: #303133;
}
</style>