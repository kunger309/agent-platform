import { IsString, IsOptional, IsObject, IsIn, IsInt, Min, Max } from 'class-validator';

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
  @IsInt()
  @Min(50)
  @Max(5000)
  chunkSize?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2000)
  chunkOverlap?: number;

  @IsOptional()
  @IsObject()
  retrievalConfig?: Record<string, any>;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'archived'])
  status?: 'active' | 'archived';
}