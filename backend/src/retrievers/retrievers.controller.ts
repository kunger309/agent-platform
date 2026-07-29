import {
  Controller,
  Post,
  Param,
  Body,
  Request,
  HttpCode,
} from '@nestjs/common';
import { RetrieversService } from './retrievers.service';
import { RetrieveDto } from './dto/retrieve.dto';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

/**
 * 检索测试 / 实际检索端点。
 *
 * POST /api/knowledge-bases/:kbId/retrieve
 * body: { query: string, topK?: number, scoreThreshold?: number }
 *
 * 权限：kb:list（检索属知识库读动作）。
 * 返回：{ success, data: { query, topK, total, results: RetrievedChunk[] } }
 */
@Controller('knowledge-bases/:kbId/retrieve')
export class RetrieversController {
  constructor(private readonly retrievers: RetrieversService) {}

  @Post()
  @RequirePermission('kb:list')
  @HttpCode(200)
  async retrieve(
    @Param('kbId') kbId: string,
    @Body() dto: RetrieveDto,
    @Request() req: any,
  ) {
    const data = await this.retrievers.retrieve(
      req.user.currentOrgId,
      kbId,
      dto.query,
      { topK: dto.topK, scoreThreshold: dto.scoreThreshold },
    );
    return { success: true, data };
  }
}
