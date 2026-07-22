<template>
  <div class="page">
    <h2 class="page-title">个人中心</h2>
    <el-row :gutter="16">
      <el-col :xs="24" :md="8">
        <el-card shadow="never">
          <div class="avatar-block">
            <el-avatar :size="80" :icon="UserFilled" />
            <h3>{{ user.nickname || user.username }}</h3>
            <el-tag v-for="r in user.roles" :key="r" type="success" size="small" style="margin-right: 4px">{{ r }}</el-tag>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :md="16">
        <el-card shadow="never">
          <template #header><span><el-icon><Lock /></el-icon> 修改密码</span></template>
          <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
            <el-form-item label="原密码" prop="oldPassword"><el-input v-model="form.oldPassword" type="password" show-password /></el-form-item>
            <el-form-item label="新密码" prop="newPassword"><el-input v-model="form.newPassword" type="password" show-password /></el-form-item>
            <el-form-item label="确认密码" prop="confirmPassword"><el-input v-model="form.confirmPassword" type="password" show-password /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="changePassword">保存</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { UserFilled, Lock } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import { changePassword as apiChangePwd } from '@/api';

const userStore = useUserStore();
const user = computed(() => userStore.profile || {});

const formRef = ref(null);
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });

const rules = {
  oldPassword: [{ required: true, message: '请输入原密码' }],
  newPassword: [
    { required: true, message: '请输入新密码' },
    { min: 8, message: '至少 8 位' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码' },
    { validator: (_, v, cb) => v === form.newPassword ? cb() : cb(new Error('两次密码不一致')) },
  ],
};

async function changePassword() {
  await formRef.value.validate();
  try {
    await apiChangePwd({ oldPassword: form.oldPassword, newPassword: form.newPassword });
    ElMessage.success('修改成功，请重新登录');
    userStore.logout();
  } catch (e) {
    ElMessage.error(e?.message || '修改失败');
  }
}
</script>

<style scoped>
.page-title { margin: 0 0 16px; font-weight: 600; }
.avatar-block { text-align: center; padding: 16px 0; }
.avatar-block h3 { margin: 12px 0 8px; }
</style>
