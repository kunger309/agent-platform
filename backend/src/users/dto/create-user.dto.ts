import { IsString, IsOptional, IsEmail, IsArray, IsIn, MinLength, MaxLength, Matches, ValidateIf } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_-]+$/, { message: 'Username can only contain letters, numbers, _ and -' })
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  /** 邮箱（可选）：空串视为不填；非空时必须是合法邮箱 */
  @IsOptional()
  @ValidateIf((o) => !!o.email && o.email.length > 0)
  @IsEmail()
  email?: string;

  /** 角色代码列表（可选；不传则不绑角色） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];

  /** 用户状态（可选；默认 active） */
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  /** 主组织 ID（可选；绑定用户到某组织） */
  @IsOptional()
  @IsString()
  organizationId?: string;
}