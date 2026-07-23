import client from './client';

export const listProviders = () => client.get('/llm-providers');
export const getProvider = (id) => client.get(`/llm-providers/${id}`);
export const createProvider = (data) => client.post('/llm-providers', data);
export const updateProvider = (id, data) => client.patch(`/llm-providers/${id}`, data);
export const deleteProvider = (id) => client.delete(`/llm-providers/${id}`);
export const testProvider = (id) => client.post(`/llm-providers/${id}/test`);

export const PROVIDER_TYPES = [
  { value: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1' },
  { value: 'qwen', label: '通义千问', defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'zhipu', label: '智谱', defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { value: 'MiniMax', label: 'MiniMax', defaultBaseUrl: 'https://api.minimaxi.com/v1' },
  { value: 'ollama', label: 'Ollama（本地）', defaultBaseUrl: 'http://localhost:11434/v1' },
  { value: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com' },
  { value: 'custom', label: '自定义 OpenAI 兼容', defaultBaseUrl: '' },
];

export const DEFAULT_MODELS = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  qwen: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
  zhipu: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
  MiniMax: ['MiniMax-M3', 'MiniMax-Text-01', 'abab6.5s-chat'],
  ollama: ['qwen2.5', 'llama3.1', 'mistral'],
};