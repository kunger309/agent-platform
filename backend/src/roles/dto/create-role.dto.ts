import { IsString, IsOptional, IsArray, IsIn, MaxLength, IsNotEmpty } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  @IsOptional()
  @IsIn(['ALL', 'ORG', 'ORG_AND_CHILDREN', 'SELF', 'CUSTOM'])
  dataScope?: 'ALL' | 'ORG' | 'ORG_AND_CHILDREN' | 'SELF' | 'CUSTOM';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];

  /** 父角色 id：自动继承其全部权限 */
  @IsOptional()
  @IsString()
  parentId?: string;
}
