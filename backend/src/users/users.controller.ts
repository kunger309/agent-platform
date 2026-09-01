import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ResetPasswordDto } from './dto/update-user.dto';
import { MaskResource } from '../common/decorators/mask-resource.decorator';

/**
 * user 资源权限码集中常量。
 * ⚠️ 必须与 prisma/seed.ts 中 PERMISSIONS 表注册的真名保持一致：
 *    user:list / user:create / user:edit / user:delete / user:reset-password
 * 之前出现过装饰器写 `user:update`、seed 真名是 `user:edit` 的错位，
 * 导致任何角色（含内置 admin）编辑用户都 403。统一在此引用可让编辑器即时报错。
 */
export const USER_PERMS = {
  LIST: 'user:list',
  CREATE: 'user:create',
  EDIT: 'user:edit',
  DELETE: 'user:delete',
  RESET_PASSWORD: 'user:reset-password',
} as const;

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@MaskResource('user')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission(USER_PERMS.LIST)
  async list(@Request() req, @Query() query) {
    const users = await this.usersService.findAll(req.user, query);
    return { success: true, data: users };
  }

  @Get(':id')
  @RequirePermission(USER_PERMS.LIST)
  async detail(@Param('id') id: string) {
    const user = await this.usersService.findOne(id);
    return { success: true, data: user };
  }

  @Post()
  @RequirePermission(USER_PERMS.CREATE)
  async create(@Body() dto: CreateUserDto, @Request() req) {
    const user = await this.usersService.create(dto, req.user);
    return { success: true, data: user };
  }

  @Patch(':id')
  @RequirePermission(USER_PERMS.EDIT)
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req) {
    const user = await this.usersService.update(id, dto, req.user);
    return { success: true, data: user };
  }

  @Delete(':id')
  @RequirePermission(USER_PERMS.DELETE)
  @HttpCode(200)
  async remove(@Param('id') id: string, @Request() req) {
    const result = await this.usersService.remove(id, req.user);
    return { success: true, data: result };
  }

  @Post(':id/reset-password')
  @RequirePermission(USER_PERMS.RESET_PASSWORD)
  @HttpCode(200)
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    const result = await this.usersService.resetPassword(id, dto);
    return { success: true, data: result };
  }
}
