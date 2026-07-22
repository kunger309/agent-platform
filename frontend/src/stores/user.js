import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import * as authApi from '@/api/auth';

export const useUserStore = defineStore('user', () => {
  const user = ref(null);
  const token = ref(localStorage.getItem('agent_platform_token') || '');

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
   * 从 token 恢复用户信息（页面刷新时）
   */
  function restoreFromToken() {
    const restored = authApi.getCurrentUser();
    if (restored) {
      user.value = restored;
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