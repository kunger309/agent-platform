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

/* ---------- 字段级权限 ---------- */

/** 可做字段管控的资源字典：[{ resource, label, fields: [{ field, label }] }] */
export const listMaskableResources = () => client.get('/roles/field-permissions/resources');

/** 某角色已配置的字段策略：[{ resource, field, access }] */
export const listFieldPermissions = (id) => client.get(`/roles/${id}/field-permissions`);

/** 全量替换字段策略（先删后建语义，传空数组即清空） */
export const setFieldPermissions = (id, items) =>
  client.put(`/roles/${id}/field-permissions`, { items });
