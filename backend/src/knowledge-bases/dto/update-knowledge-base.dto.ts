import { IsString, IsOptional, IsObject, IsIn } from 'class-validator';

export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  embeddingModel?: string;

  @IsOptional()
  @IsString()
  embeddingProviderId?: string;

  @IsOptional()
  @IsObject()
  retrievalConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}