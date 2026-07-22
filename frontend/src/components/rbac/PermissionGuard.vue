<script setup>
import { computed } from 'vue';
import { usePermissionStore } from '@/stores/permission';

/**
 * 按钮/菜单级别权限控制
 * @example
 *   <PermissionGuard code="user:create">
 *     <el-button @click="onCreate">新增用户</el-button>
 *   </PermissionGuard>
 *
 *   <PermissionGuard :any="['user:edit', 'user:delete']">
 *     <el-button>编辑</el-button>
 *   </PermissionGuard>
 */
const props = defineProps({
  code: { type: String, default: '' },
  any: { type: Array, default: () => [] },
  all: { type: Array, default: () => [] },
});

const permissionStore = usePermissionStore();

const allowed = computed(() => {
  if (props.code && !permissionStore.has(props.code)) return false;
  if (props.any.length > 0 && !permissionStore.hasAny(props.any)) return false;
  if (props.all.length > 0 && !permissionStore.hasAll(props.all)) return false;
  return true;
});
</script>

<template>
  <slot v-if="allowed" />
</template>