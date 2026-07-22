<template>
  <div class="error-page">
    <el-result icon="warning" title="403 无权限访问" sub-title="您当前角色无权访问此页面">
      <template #extra>
        <el-button type="primary" @click="$router.push('/')">返回首页</el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.error-page { height: 80vh; display: flex; align-items: center; justify-content: center; }
</style>
