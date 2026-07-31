import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { API_SCOPES, CreateApiKeyDto, UpdateApiKeyDto } from './dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { MaskResource } from '../common/decorators/mask-resource.decorator';

@Controller('api-keys')
@MaskResource('apiKey')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  /** 可选范围字典，供前端渲染多选框 */
  @Get('scopes')
  @RequirePermission('apikey:list')
  scopes() {
    const labels: Record<string, string> = {
      'agent:read': '读取智能体列表',
      'agent:chat': '调用智能体对话',
      'workflow:read': '读取工作流列表',
      'workflow:run': '运行工作流',
      'kb:search': '检索知识库',
    };
    return {
      success: true,
      data: API_SCOPES.map((code) => ({ code, label: labels[code] || code })),
    };
  }

  @Get()
  @RequirePermission('apikey:list')
  async list(@Request() req: any) {
    const data = await this.apiKeys.list(req.user.currentOrgId);
    return { success: true, data };
  }

  @Post()
  @RequirePermission('apikey:create')
  @HttpCode(201)
  async create(@Body() dto: CreateApiKeyDto, @Request() req: any) {
    const data = await this.apiKeys.create(
      req.user.currentOrgId,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('apikey:edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto,
    @Request() req: any,
  ) {
    const data = await this.apiKeys.update(id, req.user.currentOrgId, dto);
    return { success: true, data };
  }

  @Post(':id/rotate')
  @RequirePermission('apikey:edit')
  @HttpCode(200)
  async rotate(@Param('id') id: string, @Request() req: any) {
    const data = await this.apiKeys.rotate(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Post(':id/revoke')
  @RequirePermission('apikey:edit')
  @HttpCode(200)
  async revoke(@Param('id') id: string, @Request() req: any) {
    const data = await this.apiKeys.revoke(id, req.user.currentOrgId);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('apikey:delete')
  async remove(@Param('id') id: string, @Request() req: any) {
    const data = await this.apiKeys.remove(id, req.user.currentOrgId);
    return { success: true, data };
  }
}
