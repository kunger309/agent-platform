import client from './client';

export const fetchRoles = () => client.get('/roles');