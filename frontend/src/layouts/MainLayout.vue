<script setup>
import Sidebar from './components/Sidebar.vue';
import TopBar from './components/TopBar.vue';
</script>

<template>
  <el-container class="main-layout">
    <el-aside :width="'var(--sidebar-width)'" class="sidebar">
      <Sidebar />
    </el-aside>
    <el-container class="right">
      <el-header class="topbar">
        <TopBar />
      </el-header>
      <el-main class="content">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.main-layout {
  height: 100vh;
  width: 100vw;
}
.sidebar {
  background: var(--brand-bg);
  color: #fff;
  overflow: hidden;
  transition: width 0.2s;
  flex-shrink: 0;
}
.right {
  flex: 1;
  min-width: 0;  /* 关键：让内容区能缩 */
}
.topbar {
  background: #fff;
  border-bottom: 1px solid var(--border-soft);
  padding: 0;
  height: var(--topbar-height);
  flex-shrink: 0;
}
.content {
  background: var(--content-bg);
  padding: var(--content-padding);
  overflow: auto;
  height: calc(100vh - var(--topbar-height));
}
</style>