import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
  UseGuards,
  Body,
  Param,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';
import { SetFieldPermissionsDto } from './dto/set-field-permissions.dto';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('role:list')
  async list() {
    const roles = await this.rolesService.findAll();
    return { success: true, data: roles };
  }

  @Post()
  @RequirePermission('role:create')
  async create(@Body() dto: CreateRoleDto) {
    const role = await this.rolesService.create(dto);
    return { success: true, data: role };
  }

  @Patch(':id')
  @RequirePermission('role:edit')
  async update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const role = await this.rolesService.update(id, dto);
    return { success: true, data: role };
  }

  @Delete(':id')
  @RequirePermission('role:delete')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    const result = await this.rolesService.remove(id);
    return { success: true, data: result };
  }

  @Put(':id/permissions')
  @RequirePermission('role:assign')
  @HttpCode(200)
  async assignPermissions(@Param('id') id: string, @Body() dto: AssignPermissionsDto) {
    const role = await this.rolesService.assignPermissions(id, dto.permissionCodes);
    return { success: true, data: role };
  }

  /** 字段级权限：可脱敏资源字典 */
  @Get('field-permissions/resources')
  @RequirePermission('role:list')
  async maskableResources() {
    return { success: true, data: this.rolesService.listMaskableResources() };
  }

  @Get(':id/field-permissions')
  @RequirePermission('role:list')
  async listFieldPermissions(@Param('id') id: string) {
    const items = await this.rolesService.listFieldPermissions(id);
    return { success: true, data: items };
  }

  @Put(':id/field-permissions')
  @RequirePermission('role:assign')
  @HttpCode(200)
  async setFieldPermissions(@Param('id') id: string, @Body() dto: SetFieldPermissionsDto) {
    const items = await this.rolesService.setFieldPermissions(id, dto.items || []);
    return { success: true, data: items };
  }
}
