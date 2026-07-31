import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, HttpCode } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto, ResetPasswordDto } from './dto/update-user.dto';
import { MaskResource } from '../common/decorators/mask-resource.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@MaskResource('user')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('user:list')
  async list(@Request() req, @Query() query) {
    const users = await this.usersService.findAll(req.user, query);
    return { success: true, data: users };
  }

  @Get(':id')
  @RequirePermission('user:list')
  async detail(@Param('id') id: string) {
    const user = await this.usersService.findOne(id);
    return { success: true, data: user };
  }

  @Post()
  @RequirePermission('user:create')
  async create(@Body() dto: CreateUserDto, @Request() req) {
    const user = await this.usersService.create(dto, req.user);
    return { success: true, data: user };
  }

  @Patch(':id')
  @RequirePermission('user:update')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req) {
    const user = await this.usersService.update(id, dto, req.user);
    return { success: true, data: user };
  }

  @Delete(':id')
  @RequirePermission('user:delete')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    const result = await this.usersService.remove(id);
    return { success: true, data: result };
  }

  @Post(':id/reset-password')
  @RequirePermission('user:update')
  @HttpCode(200)
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
    const result = await this.usersService.resetPassword(id, dto);
    return { success: true, data: result };
  }
}
