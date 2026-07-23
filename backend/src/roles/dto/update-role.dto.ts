import { IsString, IsOptional, IsIn, MaxLength, IsArray } from 'class-validator';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

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
}
