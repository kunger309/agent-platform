import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as authApi from '@/api/auth';

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('agent_platform_token') || '');
  // ★ 启动时优先从 localStorage 读 user（避开 atob 边界）
  const user = ref(authApi.getStoredUser() || authApi.getCurrentUser() || null);

  const isLoggedIn = computed(() => !!token.value && !!user.value);
  const isSuperAdmin = computed(() => user.value?.isSuperAdmin === true);

  /**
   * 登录
   */
  async function login(username, password) {
    const data = await authApi.login(username, password);
    token.value = data.accessToken;
    user.value = data.user;
    return data.user;
  }

  /**
   * 登出
   */
  async function logout() {
    await authApi.logout();
    token.value = '';
    user.value = null;
  }

  /**
   * 从 token + localStorage 恢复用户信息（页面刷新时）
   * - 同步，无副作用
   */
  function restoreFromToken() {
    // 优先用存的 user 对象（解析更快、更可靠）；其次从 token 解码
    const stored = authApi.getStoredUser();
    const fromToken = authApi.getCurrentUser();
    const restored = stored || fromToken;
    if (restored) {
      user.value = restored;
    } else if (token.value) {
      // token 有但 user 解析不出来 → token 已过期或损坏
      token.value = '';
      user.value = null;
    }
  }

  return {
    user,
    token,
    isLoggedIn,
    isSuperAdmin,
    login,
    logout,
    restoreFromToken,
  };
});
