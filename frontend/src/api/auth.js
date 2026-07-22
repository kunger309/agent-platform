import client, { setToken, clearToken } from './client';

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
  return data;
};

/**
 * 登出（前端清 token + 服务端记录）
 */
export const logout = async () => {
  try {
    await client.post('/auth/logout');
  } catch (e) {
    // 即使接口失败也清空本地 token
  }
  clearToken();
};

/**
 * 获取当前用户信息（从 token 解析或调接口）
 * 这里直接从 token 解析（JWT payload 在 base64 中），避免额外请求
 */
export const getCurrentUser = () => {
  const token = localStorage.getItem('agent_platform_token');
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      id: payload.sub,
      username: payload.username,
      isSuperAdmin: payload.isSuperAdmin,
      roles: payload.roles || [],
      permissionCodes: payload.permissionCodes || [],
      organizations: payload.organizations || [],
      currentOrgId: payload.currentOrgId,
    };
  } catch (e) {
    return null;
  }
};