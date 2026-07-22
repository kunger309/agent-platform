/**
 * Axios 客户端
 * - 自动注入 Authorization 头
 * - 401 自动登出 + 跳转登录页
 * - 统一响应数据解包（{ success, data, message }）
 */
import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from '@/router';

const TOKEN_KEY = 'agent_platform_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

const client = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

// ===== 请求拦截器：注入 token =====
client.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ===== 响应拦截器：401 处理 + 数据解包 =====
client.interceptors.response.use(
  (response) => {
    const body = response.data;
    // 后端统一返回 { success, data, message }
    if (body && typeof body === 'object' && 'success' in body) {
      if (!body.success) {
        ElMessage.error(body.message || '请求失败');
        return Promise.reject(new Error(body.message || 'Request failed'));
      }
      return body.data;
    }
    return body;
  },
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    if (status === 401) {
      clearToken();
      ElMessage.warning('登录已过期，请重新登录');
      // 避免无限重定向：只在非登录页时跳转
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login');
      }
    } else if (status === 403) {
      ElMessage.error('权限不足');
    } else if (status >= 500) {
      ElMessage.error('服务器错误：' + message);
    } else if (message && status !== 404) {
      ElMessage.error(message);
    }

    return Promise.reject(error);
  },
);

export default client;