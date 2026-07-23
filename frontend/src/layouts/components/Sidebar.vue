<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import routes from '@/router/routes';
import { usePermissionStore } from '@/stores/permission';

const route = useRoute();
const permissionStore = usePermissionStore();

const menuItems = computed(() => {
  const traverse = (items) => {
    return items
      .filter((item) => !item.meta?.hideInMenu)
      .filter((item) => {
        const code = item.meta?.permission;
        const any = item.meta?.permissionAny;
        if (code && !permissionStore.has(code)) return false;
        if (any && !permissionStore.hasAny(any)) return false;
        return true;
      })
      .map((item) => ({
        path: item.path,
        title: item.meta?.title || '',
        icon: item.meta?.icon || '',
        children: item.children ? traverse(item.children) : [],
      }));
  };
  return traverse(routes);
});

const activeMenu = computed(() => route.path);
</script>

<template>
  <div class="sidebar">
    <div class="logo">
      <div class="logo-mark">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.27A7 7 0 0 1 14 22v-1a1 1 0 0 1-1-1v-1.27A7 7 0 0 1 8 14H6a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z"/>
        </svg>
      </div>
      <div class="logo-text">
        <div class="logo-title">AI Agent</div>
        <div class="logo-sub">智能体平台</div>
      </div>
    </div>

    <el-menu
      :default-active="activeMenu"
      background-color="transparent"
      text-color="#bfcbd9"
      active-text-color="#fff"
      router
      class="sidebar-menu"
    >
      <template v-for="item in menuItems" :key="item.path">
        <el-menu-item v-if="!item.children.length" :index="item.path">
          <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
        <el-sub-menu v-else :index="item.path">
          <template #title>
            <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </template>
          <el-menu-item
            v-for="child in item.children"
            :key="child.path"
            :index="`${item.path === '/' ? '' : item.path}/${child.path}`"
          >
            <el-icon v-if="child.icon"><component :is="child.icon" /></el-icon>
            <span>{{ child.title }}</span>
          </el-menu-item>
        </el-sub-menu>
      </template>
    </el-menu>
  </div>
</template>

<style scoped>
.sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #001529 0%, #002140 100%);
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #fff;
  flex-shrink: 0;
}
.logo-mark {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, #409eff 0%, #67c23a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(64, 158, 255, 0.4);
}
.logo-text { display: flex; flex-direction: column; line-height: 1.2; }
.logo-title { font-size: 15px; font-weight: 600; }
.logo-sub { font-size: 11px; color: rgba(255, 255, 255, 0.55); margin-top: 1px; }

.sidebar-menu {
  border-right: none;
  flex: 1;
  padding: 8px 0;
}

:deep(.el-menu-item),
:deep(.el-sub-menu__title) {
  margin: 2px 8px;
  border-radius: 6px;
  height: 42px;
  line-height: 42px;
}
:deep(.el-menu-item:hover),
:deep(.el-sub-menu__title:hover) {
  background-color: rgba(255, 255, 255, 0.05) !important;
}
:deep(.el-menu-item.is-active) {
  background: linear-gradient(90deg, #1890ff 0%, #096dd9 100%) !important;
  color: #fff !important;
  box-shadow: 0 2px 6px rgba(24, 144, 255, 0.35);
}
:deep(.el-sub-menu .el-menu-item) {
  margin-left: 16px;
  width: auto;
  font-size: 13px;
}
</style>
