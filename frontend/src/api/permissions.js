import client from './client';

export const fetchPermissionTree = () => client.get('/permissions/tree');
export const fetchMyPermissions = () => client.get('/permissions/mine');