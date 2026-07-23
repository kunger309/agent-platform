import { IsString, IsOptional, IsEmail, IsArray, MinLength, MaxLength, IsIn, ValidateIf } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  /** 邮箱（可选）：空串视为不填；非空时必须是合法邮箱 */
  @IsOptional()
  @ValidateIf((o) => !!o.email && o.email.length > 0)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsIn(['active', 'disabled', 'locked'])
  status?: 'active' | 'disabled' | 'locked';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];

  /** 主组织 ID（可选；传 null/空 表示解绑主组织） */
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword!: string;
}
