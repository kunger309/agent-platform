<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import MainLayout from '@/layouts/MainLayout.vue';
import BlankLayout from '@/layouts/BlankLayout.vue';

const route = useRoute();

// 根据路由 meta.layout 决定渲染哪种布局
// - 'blank' → 登录 / 403 / 404 等公开页（无侧边栏）
// - 其他（受保护路由） → 主布局（含侧边栏 + 顶栏）
const isBlank = computed(() => route.meta?.layout === 'blank');
</script>

<template>
  <MainLayout v-if="!isBlank" />
  <BlankLayout v-else />
</template>

<style>
#app {
  height: 100vh;
  width: 100vw;
}
</style>