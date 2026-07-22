import client from './client';

export const fetchUsers = () => client.get('/users');

export const createUser = (data) => client.post('/users', data);