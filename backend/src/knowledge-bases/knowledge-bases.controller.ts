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
import { KnowledgeBasesService } from './knowledge-bases.service';
import {
  CreateKnowledgeBaseDto,
  UpdateKnowledgeBaseDto,
} from './dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

@Controller('knowledge-bases')
export class KnowledgeBasesController {
  constructor(private readonly kbs: KnowledgeBasesService) {}

  @Get()
  @RequirePermission('kb:list')
  async list(@Request() req: any) {
    const data = await this.kbs.list(req.user.currentOrgId);
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('kb:list')
  async detail(@Param('id') id: string, @Request() req: any) {
    const data = await this.kbs.detail(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('kb:create')
  @HttpCode(201)
  async create(@Body() dto: CreateKnowledgeBaseDto, @Request() req: any) {
    const data = await this.kbs.create(
      req.user.currentOrgId,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('kb:edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeBaseDto,
    @Request() req: any,
  ) {
    const data = await this.kbs.update(id, req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('kb:delete')
  @HttpCode(200)
  async delete(@Param('id') id: string, @Request() req: any) {
    return this.kbs.delete(id, req.user.currentOrgId);
  }
}