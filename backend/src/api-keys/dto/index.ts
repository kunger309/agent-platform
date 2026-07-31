import {
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** 对外 API 可授予的能力范围 */
export const API_SCOPES = [
  'agent:read',
  'agent:chat',
  'workflow:read',
  'workflow:run',
  'kb:search',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;

  /** 未传则默认授予全部只读 + 调用范围 */
  @IsOptional()
  @IsArray()
  @IsIn(API_SCOPES as unknown as string[], { each: true })
  scopes?: string[];

  /** ISO 时间串；不传表示永不过期 */
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsIn(API_SCOPES as unknown as string[], { each: true })
  scopes?: string[];

  @IsOptional()
  @IsIn(['active', 'revoked'])
  status?: string;

  /** 传 null 语义由前端显式传空字符串表达"清除过期时间" */
  @IsOptional()
  @IsString()
  expiresAt?: string;
}
