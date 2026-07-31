import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';

import App from './App.vue';
import router from './router';
import { useUserStore } from './stores/user';
import { useThemeStore } from './stores/theme';
import client from './api/client';
import './styles/tokens.css';
import './style.css';

const app = createApp(App);

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

const pinia = createPinia();
app.use(pinia);

// 在应用挂载前恢复主题，避免组件先以错误主题渲染
const themeStore = useThemeStore();
themeStore.init();

// ★ 必须先注册 pinia 才能 use store
const userStore = useUserStore();
userStore.restoreFromToken();

console.log('[boot] token=', userStore.token ? userStore.token.slice(0, 20) + '...' : 'NONE');
console.log('[boot] user=', userStore.user?.username || 'NONE', 'isLoggedIn=', userStore.isLoggedIn);

// ★ 启动时主动验证 token 真伪（必须在路由首次跳转之前完成 → 用 await 阻塞）
if (userStore.token) {
  try {
    const me = await client.get('/auth/me');
    if (me) {
      // 服务端认可 token → 同步 user（覆盖可能过期的本地数据）
      userStore.user = { ...userStore.user, ...me };
      try {
        localStorage.setItem('agent_platform_user', JSON.stringify(userStore.user));
      } catch (_) {}
      console.log('[boot] /auth/me OK, user.name=', userStore.user.name);
    }
  } catch (e) {
    // ★ token 已无效 → 立即清掉，但**不主动跳登录**（让路由守卫处理）
    console.warn('[boot] /auth/me failed, status=', e?.response?.status);
    if (e?.response?.status === 401) {
      userStore.token = '';
      userStore.user = null;
      try { localStorage.removeItem('agent_platform_token'); } catch (_) {}
      try { localStorage.removeItem('agent_platform_user'); } catch (_) {}
    }
    // 网络错误等其他失败 → 保留 token，让用户进入页面（部分页面可能受 token 影响）
  }
}

app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.mount('#app');
