import client from './client';

/**
 * API Key（对外开放 API 凭据）
 *
 * 注意：明文密钥只在 create / rotate 的响应里出现一次（字段 plainKey），
 * 列表接口只返回 maskedKey，前端必须提示用户当场保存。
 */
export const listApiKeys = () => client.get('/api-keys');

export const listApiKeyScopes = () => client.get('/api-keys/scopes');

export const createApiKey = (data) => client.post('/api-keys', data);

export const updateApiKey = (id, data) => client.patch(`/api-keys/${id}`, data);

export const rotateApiKey = (id) => client.post(`/api-keys/${id}/rotate`);

export const revokeApiKey = (id) => client.post(`/api-keys/${id}/revoke`);

export const deleteApiKey = (id) => client.delete(`/api-keys/${id}`);
