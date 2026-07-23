import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  UseGuards,
  Body,
  Param,
  Request,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrganizationsController {
  constructor(private readonly orgsService: OrganizationsService) {}

  @Get()
  @RequirePermission('org:list')
  async tree() {
    const tree = await this.orgsService.findTree();
    return { success: true, data: tree };
  }

  @Get('all')
  @RequirePermission('org:list')
  async all() {
    const all = await this.orgsService.findAll();
    return { success: true, data: all };
  }

  @Post()
  @RequirePermission('org:create')
  async create(@Body() dto: CreateOrganizationDto) {
    const org = await this.orgsService.create(dto);
    return { success: true, data: org };
  }

  @Patch(':id')
  @RequirePermission('org:edit')
  async update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    const org = await this.orgsService.update(id, dto);
    return { success: true, data: org };
  }

  @Delete(':id')
  @RequirePermission('org:delete')
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    const result = await this.orgsService.remove(id);
    return { success: true, data: result };
  }
}
