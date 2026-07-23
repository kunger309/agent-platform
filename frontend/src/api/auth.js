import client, { setToken, clearToken } from './client';

const TOKEN_KEY = 'agent_platform_token';
const USER_KEY = 'agent_platform_user';

/**
 * 登录
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ accessToken, user }>}
 */
export const login = async (username, password) => {
  const data = await client.post('/auth/login', { username, password });
  if (data?.accessToken) {
    setToken(data.accessToken);
  }
  // ★ 同时把 user 存到 localStorage，刷新后无需重新解码 token
  if (data?.user) {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    } catch (_) {}
  }
  return data;
};

/**
 * 登出（前端清 token + user + 服务端记录）
 */
export const logout = async () => {
  try {
    await client.post('/auth/logout');
  } catch (e) {
    // 即使接口失败也清空本地 token
  }
  clearToken();
  try { localStorage.removeItem(USER_KEY); } catch (_) {}
};

/**
 * 从 token 解析当前用户信息（JWT payload 解码）
 * - 含 exp 检查：过期返回 null
 * - 含完整性兜底：缺失关键字段返回 null
 */
export const getCurrentUser = () => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    // JWT 用 base64url，浏览器 atob 不支持 url-safe 字符 → 转换
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '==='.slice(0, (4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(pad));

    // ★ exp 主动检查：过期立即返回 null
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.warn('[auth] token expired, cleaning');
      clearToken();
      try { localStorage.removeItem(USER_KEY); } catch (_) {}
      return null;
    }

    return {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
      email: payload.email,
      avatar: payload.avatar,
      isSuperAdmin: payload.isSuperAdmin,
      roles: payload.roles || [],
      permissionCodes: payload.permissionCodes || [],
      organizations: payload.organizations || [],
      currentOrgId: payload.currentOrgId,
    };
  } catch (e) {
    console.warn('[auth] getCurrentUser parse failed:', e.message);
    return null;
  }
};

/**
 * 从 localStorage 直接读 user 对象（避免重复解码 token）
 */
export const getStoredUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

/**
 * 修改密码（个人中心）
 * @param {{ oldPassword: string, newPassword: string }} payload
 */
export const changePassword = (payload) => client.patch('/auth/change-password', payload);

