import { IsString, IsOptional, IsEmail, IsArray, MinLength, MaxLength, IsIn } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @IsOptional()
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
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  newPassword!: string;
}
