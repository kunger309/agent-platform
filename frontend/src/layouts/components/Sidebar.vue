<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import routes from '@/router/routes';
import { usePermissionStore } from '@/stores/permission';

const route = useRoute();
const permissionStore = usePermissionStore();

// 过滤可显示的菜单（按权限码 + hideInMenu）
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
      <span class="logo-icon">🤖</span>
      <span class="logo-text">AI Agent Platform</span>
    </div>
    <el-menu
      :default-active="activeMenu"
      background-color="#001529"
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
          <el-menu-item v-for="child in item.children" :key="child.path" :index="`${item.path === '/' ? '' : item.path}/${child.path}`">
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
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
}
.logo-icon {
  margin-right: 8px;
  font-size: 24px;
}
.sidebar-menu {
  border-right: none;
  flex: 1;
}
</style>