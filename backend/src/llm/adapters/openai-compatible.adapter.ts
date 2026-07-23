import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * LLM Provider 默认端点（OpenAI 兼容协议）
 */
export const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; models: string[] }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen-long'],
  },
  zhipu: {
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'],
  },
  MiniMax: {
    baseUrl: 'https://api.minimaxi.com/v1', // 国际版（com），不是国内版 chat
    models: ['MiniMax-M3', 'MiniMax-Text-01', 'abab6.5s-chat'],
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5', 'llama3.1', 'mistral'],
  },
};

/**
 * 创建一个 OpenAI 兼容的 ChatModel 实例
 * @param options
 * @param options.providerType provider 类型（决定默认 baseUrl / 模型列表）
 * @param options.baseUrl  自定义 baseUrl（优先级高于默认）
 * @param options.apiKey   API Key
 * @param options.model    模型名
 * @param options.temperature  温度（0~1，默认 0.7）
 * @param options.streaming    是否流式
 */
export function createOpenAICompatibleChatModel(options: {
  providerType?: string;
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature?: number;
  streaming?: boolean;
  maxTokens?: number;
}): BaseChatModel {
  const {
    providerType,
    baseUrl,
    apiKey,
    model,
    temperature = 0.7,
    streaming = false,
    maxTokens,
  } = options;

  const finalBaseUrl =
    baseUrl ||
    (providerType ? PROVIDER_DEFAULTS[providerType]?.baseUrl : undefined) ||
    'https://api.openai.com/v1';

  return new ChatOpenAI({
    apiKey,
    modelName: model,
    temperature,
    maxTokens,
    streaming,
    configuration: {
      baseURL: finalBaseUrl,
    },
  });
}

/**
 * 列出某个 provider 的默认模型
 */
export function getDefaultModels(providerType: string): string[] {
  return PROVIDER_DEFAULTS[providerType]?.models ?? [];
}

/**
 * 列出某个 provider 的默认 baseUrl
 */
export function getDefaultBaseUrl(providerType: string): string | undefined {
  return PROVIDER_DEFAULTS[providerType]?.baseUrl;
}