import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsIn,
} from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(['chat', 'workflow'])
  type: 'chat' | 'workflow';

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  /**
   * 模型配置：
   * {
   *   providerId: string,  // LlmProvider.id
   *   model: string,       // 模型名
   *   temperature?: number, // 0~1, 默认 0.7
   *   maxTokens?: number,
   * }
   */
  @IsObject()
  modelConfig: {
    providerId: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsObject()
  modelConfig?: any;

  @IsOptional()
  @IsString()
  @IsIn(['draft', 'published', 'archived'])
  status?: 'draft' | 'published' | 'archived';
}

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}