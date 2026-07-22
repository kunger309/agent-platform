import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { OrganizationsService } from './organizations.service';

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
}