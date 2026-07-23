import client from './client';

/**
 * 角色 API
 * 后端返回：[{ id, code, name, description, isBuiltin, ... }]
 */
export const listRoles = () => client.get('/roles');

export const getRole = (id) => client.get(`/roles/${id}`);

export const createRole = (data) => client.post('/roles', data);

export const updateRole = (id, data) => client.patch(`/roles/${id}`, data);

export const deleteRole = (id) => client.delete(`/roles/${id}`);

export const fetchRoles = listRoles;
