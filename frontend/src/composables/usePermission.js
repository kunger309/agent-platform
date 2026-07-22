import { usePermissionStore } from '@/stores/permission';

/**
 * 权限检查 composable
 * 用法：
 *   const { has, hasAny } = usePermission();
 *   if (has('user:create')) { ... }
 */
export function usePermission() {
  const store = usePermissionStore();
  return {
    has: (code) => store.has(code),
    hasAny: (codes) => store.hasAny(codes),
    hasAll: (codes) => store.hasAll(codes),
    isSuperAdmin: store.isSuperAdmin,
  };
}