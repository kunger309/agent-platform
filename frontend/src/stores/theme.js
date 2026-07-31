import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

const STORAGE_KEY = 'agent_platform_theme';
const DEFAULT_THEME = 'light';

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : DEFAULT_THEME;
}

function readStoredTheme() {
  try {
    return normalizeTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');

  // 主题切换瞬间禁用全局 transition（消除 cell/button/menu 等的背景色过渡帧），
  // 300ms 后还原，让交互过渡恢复正常
  const body = document.body;
  if (!body) return;
  body.classList.add('theme-switching');
  if (applyTheme._t) clearTimeout(applyTheme._t);
  applyTheme._t = setTimeout(() => body.classList.remove('theme-switching'), 300);
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref(readStoredTheme());
  const isDark = computed(() => theme.value === 'dark');

  function setTheme(value) {
    theme.value = normalizeTheme(value);
    applyTheme(theme.value);
    try {
      localStorage.setItem(STORAGE_KEY, theme.value);
    } catch {
      // localStorage 不可用时仍保留本次会话主题
    }
  }

  function toggleTheme() {
    setTheme(isDark.value ? 'light' : 'dark');
  }

  function init() {
    applyTheme(theme.value);
  }

  return {
    theme,
    isDark,
    init,
    setTheme,
    toggleTheme,
  };
});
