import client from './client';

export const fetchPermissionTree = () => client.get('/permissions/tree');
export const fetchMyPermissions = () => client.get('/permissions/mine');

// ===== RoleList.vue 使用的标准命名 =====
// GET /api/permissions/tree 返回 { menuTree, buttonList, apiList }
export const listPermissions = (params) => client.get('/permissions/tree', { params });
// PUT /api/roles/:id/permissions  body: { permissionCodes: string[] }
export const assignPermissions = (roleId, data) => client.put(`/roles/${roleId}/permissions`, data);