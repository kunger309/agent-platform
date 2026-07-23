import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsIn,
  IsBoolean,
} from 'class-validator';

export const LLM_PROVIDER_TYPES = [
  'openai',
  'deepseek',
  'qwen',
  'zhipu',
  'MiniMax',
  'ollama',
  'anthropic',
  'custom',
] as const;

export class CreateLlmProviderDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(LLM_PROVIDER_TYPES as unknown as string[])
  providerType: string;

  @IsString()
  @IsNotEmpty()
  baseUrl: string;

  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @IsArray()
  @IsString({ each: true })
  models: string[];

  @IsOptional()
  @IsString()
  defaultModel?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateLlmProviderDto {
  // 与 Create 对齐：所有字段 optional，且允许修改类型 + 默认标记
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(LLM_PROVIDER_TYPES as unknown as string[])
  providerType?: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  models?: string[];

  @IsOptional()
  @IsString()
  defaultModel?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsString()
  status?: 'active' | 'disabled';
}
