import client from './client';

// 技能调用记录（ToolInvocation）：查询 + 概览
export const listToolInvocations = (params = {}) =>
  client.get('/tool-invocations', { params });
export const getToolInvocationStats = () => client.get('/tool-invocations/stats');
