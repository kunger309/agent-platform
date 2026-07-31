import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsIn,
  ValidateIf,
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
   * 仅 type=workflow 必填：绑定的流程编排工作流 ID。必须属同一组织。
   */
  @ValidateIf((o: CreateAgentDto) => o.type === 'workflow')
  @IsString()
  @IsNotEmpty({ message: 'type=workflow 时必须指定 workflowId' })
  workflowId?: string;

  /**
   * 模型配置：仅 type=chat 必填。
   * 由 service 层校验 providerId/model 是否存在（DTO 不深校验嵌套字段）。
   */
  @ValidateIf((o: CreateAgentDto) => o.type === 'chat')
  @IsObject()
  modelConfig?: {
    providerId: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['chat', 'workflow'])
  type?: 'chat' | 'workflow';

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;

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
