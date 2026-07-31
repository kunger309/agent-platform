import { IsArray, IsIn, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class FieldPermissionItemDto {
  /** 资源标识，如 user / agent / llm_provider */
  @IsString()
  @MaxLength(64)
  resource!: string;

  /** 字段名，如 email / phone */
  @IsString()
  @MaxLength(64)
  field!: string;

  @IsIn(['visible', 'masked', 'hidden'])
  access!: 'visible' | 'masked' | 'hidden';
}

export class SetFieldPermissionsDto {
  /** 全量替换该角色的字段级权限配置 */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldPermissionItemDto)
  items!: FieldPermissionItemDto[];
}
