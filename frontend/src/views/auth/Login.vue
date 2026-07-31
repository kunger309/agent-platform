<template>
  <div class="login-container">
    <div class="login-box">
      <h1 class="login-title">AI 智能体平台</h1>
      <p class="login-subtitle">Agent Platform · 登录</p>

      <el-alert
        v-if="errorMsg"
        :title="errorMsg"
        type="error"
        show-icon
        :closable="false"
        style="margin-bottom: 16px"
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="0"
        size="large"
        @keyup.enter="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="用户名"
            :prefix-icon="User"
            autocomplete="username"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
            autocomplete="current-password"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="loading"
            style="width: 100%"
            @click="handleLogin"
          >
            {{ loading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form-item>
      </el-form>

      <el-divider><span class="tip-label">默认账号</span></el-divider>
      <div class="default-tip">
        <el-tag type="info" size="small">用户名 admin</el-tag>
        <el-tag type="info" size="small">密码 123456</el-tag>
        <span class="muted">（首次登录会强制修改密码）</span>
      </div>

      <p class="copyright">© 2026 Agent Platform · Powered by NestJS + LangChain</p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const userStore = useUserStore();

const formRef = ref(null);
const loading = ref(false);
const errorMsg = ref('');

const form = reactive({ username: 'admin', password: '123456' });

const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function handleLogin() {
  errorMsg.value = '';
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    loading.value = true;
    try {
      await userStore.login(form.username, form.password);
      ElMessage.success('登录成功');
      const redirect = router.currentRoute.value.query.redirect || '/';
      router.replace(redirect);
    } catch (e) {
      errorMsg.value = e?.message || '登录失败，请检查用户名密码';
    } finally {
      loading.value = false;
    }
  });
}
</script>

<style scoped>
.login-container {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--brand-gradient);
}
.login-box {
  background: var(--surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  padding: 40px;
  width: 420px;
  box-shadow: var(--shadow-float);
  color: var(--text-regular);
}
.login-title {
  font-size: 26px;
  text-align: center;
  margin: 0 0 4px;
  color: var(--text-primary);
}
.login-subtitle {
  text-align: center;
  color: var(--text-secondary);
  margin: 0 0 28px;
  font-size: 13px;
}
.tip-label {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: normal;
}
.default-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  flex-wrap: wrap;
}
.default-tip .muted {
  color: var(--text-secondary);
  font-size: 12px;
}
.copyright {
  text-align: center;
  color: var(--text-placeholder);
  font-size: 12px;
  margin: 24px 0 0;
}
</style>
