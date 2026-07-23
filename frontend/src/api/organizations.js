import client from './client';

export const fetchOrganizationsTree = () => client.get('/organizations');
export const fetchOrganizationsAll = () => client.get('/organizations/all');

// ===== OrgTree.vue 使用的标准命名 =====
// GET /api/organizations 后端直接返回树形数组
export const listOrganizations = (params) => client.get('/organizations', { params });
export const createOrganization = (data) => client.post('/organizations', data);
export const updateOrganization = (id, data) => client.patch(`/organizations/${id}`, data);
export const deleteOrganization = (id) => client.delete(`/organizations/${id}`);