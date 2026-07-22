import { defineStore } from 'pinia';
import { computed } from 'vue';
import { useUserStore } from './user';

export const usePermissionStore = defineStore('permission', () => {
  const userStore = useUserStore();

  /** 当前用户所有权限码 */
  const codes = computed(() => userStore.user?.permissionCodes ?? []);

  /** 当前用户是否超管 */
  const isSuperAdmin = computed(() => userStore.user?.isSuperAdmin === true);

  /**
   * 是否拥有指定权限码
   */
  function has(code) {
    if (isSuperAdmin.value) return true;
    return codes.value.includes(code);
  }

  /**
   * 是否拥有任一权限码
   */
  function hasAny(requiredCodes) {
    if (isSuperAdmin.value) return true;
    if (!Array.isArray(requiredCodes) || requiredCodes.length === 0) return true;
    return requiredCodes.some((c) => codes.value.includes(c));
  }

  /**
   * 是否拥有全部权限码
   */
  function hasAll(requiredCodes) {
    if (isSuperAdmin.value) return true;
    if (!Array.isArray(requiredCodes) || requiredCodes.length === 0) return true;
    return requiredCodes.every((c) => codes.value.includes(c));
  }

  return {
    codes,
    isSuperAdmin,
    has,
    hasAny,
    hasAll,
  };
});