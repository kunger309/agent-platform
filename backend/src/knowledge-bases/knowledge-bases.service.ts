import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  CreateKnowledgeBaseDto,
  UpdateKnowledgeBaseDto,
} from './dto';

@Injectable()
export class KnowledgeBasesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 列表（仅摘要，含统计字段） */
  async list(organizationId: string) {
    const kbs = await this.prisma.knowledgeBase.findMany({
      where: { organizationId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        embeddingModel: true,
        embeddingProviderId: true,
        retrievalConfig: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            documents: true,
          },
        },
      },
    });
    // 把 _count.documents 平铺成 documentCount 便于前端使用
    return kbs.map((kb) => {
      const { _count, ...rest } = kb as any;
      return { ...rest, documentCount: _count.documents };
    });
  }

  /** 详情（含完整字段） */
  async detail(id: string, organizationId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id, organizationId },
    });
    if (!kb) throw new NotFoundException('知识库不存在');
    return kb;
  }

  /** 创建 */
  async create(
    organizationId: string,
    creatorId: string,
    dto: CreateKnowledgeBaseDto,
  ) {
    return this.prisma.knowledgeBase.create({
      data: {
        organizationId,
        creatorId,
        name: dto.name,
        description: dto.description,
        embeddingModel: dto.embeddingModel || 'text-embedding-3-small',
        embeddingProviderId: dto.embeddingProviderId || null,
        // Prisma Json 字段需要对象类型，class-validator 校验后的对象已是 plain object
        retrievalConfig: (dto.retrievalConfig || {}) as any,
        status: dto.status || 'active',
      },
    });
  }

  /** 更新（只更新存在的字段；embeddingModel 可切换模型） */
  async update(
    id: string,
    organizationId: string,
    dto: UpdateKnowledgeBaseDto,
  ) {
    await this.detail(id, organizationId);
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.embeddingModel !== undefined) data.embeddingModel = dto.embeddingModel;
    if (dto.embeddingProviderId !== undefined) data.embeddingProviderId = dto.embeddingProviderId;
    if (dto.retrievalConfig !== undefined) data.retrievalConfig = dto.retrievalConfig as any;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.knowledgeBase.update({ where: { id }, data });
  }

  /**
   * 删除（级联删除 documents + chunks 通过 Prisma onDelete: Cascade 自动完成）
   * 注意：Qdrant collection 不会自动删除，留作后续 #58 接入 documents 模块时由删除流程显式清理。
   * 这里只打日志提示，避免知识库被删后留下"指向不存在的文档"的孤立 collection。
   */
  async delete(id: string, organizationId: string) {
    await this.detail(id, organizationId);
    // 后续 #58 接入 Qdrant 删除：这里 await qdrant.deleteCollection(`org_${organizationId.slice(-8)}_${id}`)
    await this.prisma.knowledgeBase.delete({ where: { id } });
    return { success: true };
  }
}