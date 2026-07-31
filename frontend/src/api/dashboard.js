/**
 * 工作台统计 API
 */
import client from './client';

export const getDashboardStats = () => client.get('/dashboard/stats');