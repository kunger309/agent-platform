import { Controller, Get, Post, Body, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('user:list')
  async list(@Request() req) {
    const users = await this.usersService.findAll(req.user);
    return { success: true, data: users };
  }

  @Post()
  @RequirePermission('user:create')
  async create(@Body() dto: CreateUserDto, @Request() req) {
    const user = await this.usersService.create(dto, req.user);
    return { success: true, data: user };
  }
}