import client from './client';

/**
 * 用户管理 API
 *
 * 后端响应统一为 { success, data, message }，已由 client.js 解包出 data。
 * 列表返回：数组（service.findAll 已扁平化 roles）
 */
export const listUsers = (params) => client.get('/users', { params });

export const getUser = (id) => client.get(`/users/${id}`);

export const createUser = (data) => client.post('/users', data);

export const updateUser = (id, data) => client.patch(`/users/${id}`, data);

export const deleteUser = (id) => client.delete(`/users/${id}`);

export const resetPassword = (id, newPassword) =>
  client.post(`/users/${id}/reset-password`, { newPassword });

// 兼容旧调用（保留历史命名，避免其他地方引用炸了）
export const fetchUsers = listUsers;
