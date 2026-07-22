/**
 * 路由守卫
 * - 未登录访问受保护路由 → 跳 /login
 * - 已登录访问 /login → 跳 /
 * - 无权限访问 → 跳 /403
 */
import { useUserStore } from '@/stores/user';
import { usePermissionStore } from '@/stores/permission';

export function setupGuards(router) {
  router.beforeEach((to, from, next) => {
    const userStore = useUserStore();
    const permissionStore = usePermissionStore();

    // 首次加载：从 token 恢复用户信息
    if (!userStore.user) {
      userStore.restoreFromToken();
    }

    const requiresAuth = to.meta?.requiresAuth !== false && to.path !== '/login';

    // 1. 未登录访问受保护路由 → 跳登录
    if (requiresAuth && !userStore.isLoggedIn) {
      return next({ path: '/login', query: { redirect: to.fullPath } });
    }

    // 2. 已登录访问 /login → 跳工作台
    if (to.path === '/login' && userStore.isLoggedIn) {
      return next('/');
    }

    // 3. 权限码检查
    const requiredCode = to.meta?.permission;
    const requiredAny = to.meta?.permissionAny;
    if (requiresAuth && requiredCode && !permissionStore.has(requiredCode)) {
      return next('/403');
    }
    if (requiresAuth && requiredAny && !permissionStore.hasAny(requiredAny)) {
      return next('/403');
    }

    // 4. 设置页面标题
    if (to.meta?.title) {
      document.title = `${to.meta.title} - AI Agent Platform`;
    }

    next();
  });
}