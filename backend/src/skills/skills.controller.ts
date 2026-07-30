import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Request,
  HttpCode,
} from '@nestjs/common';
import { SkillsService } from './skills.service';
import {
  CreateSkillDto,
  UpdateSkillDto,
  CreateSkillVersionDto,
  TestSkillDto,
} from './dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @RequirePermission('skill:list')
  async list(@Request() req: any) {
    const data = await this.skills.list(req.user.currentOrgId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('skill:list')
  async detail(@Param('id') id: string, @Request() req: any) {
    const data = await this.skills.detail(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('skill:create')
  @HttpCode(201)
  async create(@Body() dto: CreateSkillDto, @Request() req: any) {
    const data = await this.skills.create(
      req.user.currentOrgId,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Post(':id/versions')
  @RequirePermission('skill:edit')
  @HttpCode(201)
  async createVersion(
    @Param('id') id: string,
    @Body() dto: CreateSkillVersionDto,
    @Request() req: any,
  ) {
    const data = await this.skills.createVersion(id, req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('skill:edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSkillDto,
    @Request() req: any,
  ) {
    const data = await this.skills.update(id, req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('skill:delete')
  @HttpCode(200)
  async remove(@Param('id') id: string, @Request() req: any) {
    return this.skills.remove(id, req.user.currentOrgId);
  }

  @Post(':id/test')
  @RequirePermission('skill:list')
  async test(
    @Param('id') id: string,
    @Body() dto: TestSkillDto,
    @Request() req: any,
  ) {
    const data = await this.skills.test(id, req.user.currentOrgId, req.user.userId, dto);
    return { success: true, data };
  }
}
