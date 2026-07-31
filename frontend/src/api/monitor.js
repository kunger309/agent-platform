import client from './client';

/**
 * 系统监控
 * - summary: 走 JWT 的聚合看板数据（执行成功率 / 趋势 / 实体存量 / 进程指标）
 * - Prometheus 原始指标在 /api/metrics，由 Prometheus 抓取，前端不直接消费
 */
export const getMonitorSummary = (params) => client.get('/monitor/summary', { params });
