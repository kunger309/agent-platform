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
        <img src="/logo.svg" alt="logo" class="logo-img" />
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
