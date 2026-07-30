import client from './client';

// ============ 技能（Skills 工具市场）============
export const listSkills = () => client.get('/skills');
export const getSkill = (id) => client.get(`/skills/${id}`);
export const createSkill = (data) => client.post('/skills', data);
export const updateSkill = (id, data) => client.patch(`/skills/${id}`, data);
export const deleteSkill = (id) => client.delete(`/skills/${id}`);

// 新增一个版本
export const createSkillVersion = (id, data) =>
  client.post(`/skills/${id}/versions`, data);

// 测试调用：body 形如 { input?: object, version?: number }
export const testSkill = (id, body = {}) => client.post(`/skills/${id}/test`, body);

// 智能体技能绑定
export const getAgentSkills = (agentId) =>
  client.get(`/agents/${agentId}/skills`);
export const setAgentSkills = (agentId, skills) =>
  client.put(`/agents/${agentId}/skills`, { skills });
