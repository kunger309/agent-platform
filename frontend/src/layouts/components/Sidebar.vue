<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import routes from '@/router/routes';
import { usePermissionStore } from '@/stores/permission';
import { useThemeStore } from '@/stores/theme';

const route = useRoute();
const permissionStore = usePermissionStore();
const themeStore = useThemeStore();

const sidebarText = computed(() => themeStore.isDark ? '#cbd5e1' : 'var(--sidebar-text)');
const sidebarActiveText = computed(() => themeStore.isDark ? '#ffffff' : 'var(--sidebar-text-active)');
const logoTitleColor = computed(() => themeStore.isDark ? '#ffffff' : 'var(--text-primary)');
const logoSubColor = computed(() => themeStore.isDark ? 'rgba(255,255,255,0.55)' : 'var(--text-secondary)');

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
        <img src="/logo.svg" alt="logo" class="logo-img" />
      </div>
      <div class="logo-text">
        <div class="logo-title" :style="{ color: logoTitleColor }">AI Agent</div>
        <div class="logo-sub" :style="{ color: logoSubColor }">智能体平台</div>
      </div>
    </div>

    <el-menu
      :default-active="activeMenu"
      background-color="transparent"
      :text-color="sidebarText"
      :active-text-color="sidebarActiveText"
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
  background: linear-gradient(180deg, var(--sidebar-bg) 0%, var(--sidebar-bg-2) 100%);
  transition: background 0.2s ease;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--sidebar-divider);
  flex-shrink: 0;
  transition: border-color 0.2s ease;
}
.logo-mark {
  width: 88px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.logo-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: left center;
}
.logo-text { display: flex; flex-direction: column; line-height: 1.2; }
.logo-title { font-size: 15px; font-weight: 600; transition: color 0.2s ease; }
.logo-sub { font-size: 11px; margin-top: 1px; transition: color 0.2s ease; }

.sidebar-menu {
  border-right: none;
  flex: 1;
  padding: 8px 0;
}

:deep(.el-menu-item),
:deep(.el-sub-menu__title) {
  margin: 2px 8px;
  border-radius: var(--radius-sm);
  height: 42px;
  line-height: 42px;
}
:deep(.el-menu-item:hover),
:deep(.el-sub-menu__title:hover) {
  background-color: var(--sidebar-hover) !important;
}
:deep(.el-menu-item.is-active) {
  background: var(--sidebar-active) !important;
  color: var(--sidebar-text-active) !important;
  box-shadow: var(--sidebar-active-shadow);
}
:deep(.el-sub-menu .el-menu-item) {
  margin-left: 16px;
  width: auto;
  font-size: 13px;
}
</style>