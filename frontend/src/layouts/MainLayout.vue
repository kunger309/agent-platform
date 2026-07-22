<script setup>
import Sidebar from './components/Sidebar.vue';
import TopBar from './components/TopBar.vue';
</script>

<template>
  <el-container class="main-layout">
    <el-aside :width="'220px'" class="sidebar">
      <Sidebar />
    </el-aside>
    <el-container>
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
}
.sidebar {
  background: #001529;
  color: #fff;
  overflow: hidden;
  transition: width 0.2s;
}
.topbar {
  background: #fff;
  border-bottom: 1px solid #e8e8e8;
  padding: 0;
}
.content {
  background: #f0f2f5;
  padding: 16px;
  overflow: auto;
}
</style>