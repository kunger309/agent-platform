import client from './client';

export const fetchOrganizationsTree = () => client.get('/organizations');
export const fetchOrganizationsAll = () => client.get('/organizations/all');