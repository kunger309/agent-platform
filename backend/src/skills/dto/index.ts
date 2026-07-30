import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsIn,
} from 'class-validator';

/**
 * 创建技能：同时创建 v1 版本。
 * - function 类型：sourceCode 必填，schemaJson 描述输入参数
 * - openapi 类型：openapiSchema 必填
 */
export class CreateSkillDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsIn(['openapi', 'function'])
  type: 'openapi' | 'function';

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  /** function 类型的输入参数 JSON Schema（用于前端表单 / 生成 tool 参数描述） */
  @IsOptional()
  @IsObject()
  schemaJson?: Record<string, any>;

  /** function 类型的 JS 源代码（以 return 返回结果，入参名为 input） */
  @IsOptional()
  @IsString()
  sourceCode?: string;

  /** openapi 类型的 OpenAPI 文档（JSON 或 YAML 字符串） */
  @IsOptional()
  @IsObject()
  openapiSchema?: Record<string, any>;

  /** 安全策略：{ allowedDomains?: string[], maxDuration?: number } */
  @IsOptional()
  @IsObject()
  securityPolicy?: Record<string, any>;
}

/** 更新技能元数据（不含版本内容） */
export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

/** 新增一个版本（基于上一版本递增） */
export class CreateSkillVersionDto {
  @IsOptional()
  @IsObject()
  schemaJson?: Record<string, any>;

  @IsOptional()
  @IsString()
  sourceCode?: string;

  @IsOptional()
  @IsObject()
  openapiSchema?: Record<string, any>;

  @IsOptional()
  @IsObject()
  securityPolicy?: Record<string, any>;
}

/** 测试调用：传入输入，返回执行结果 */
export class TestSkillDto {
  /** 输入参数对象（function 类型作为 input；openapi 类型含 operation 与方法/路径参数/body） */
  @IsOptional()
  @IsObject()
  input?: Record<string, any>;

  /** 指定版本号，默认用最新版 */
  @IsOptional()
  version?: number;
}
