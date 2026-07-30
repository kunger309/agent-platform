import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ParsersService } from '../parsers/parsers.service';
import { SplittersService } from '../splitters/splitters.service';
import { DocumentChunk as SplitterChunk } from '../splitters/splitters.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

/** 上传文件落盘目录（相对 backend 根） */
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'documents');
/** 单文档切片默认参数（KB 未指定时用此兜底） */
const DEFAULT_CHUNK_SIZE = 800;
const DEFAULT_CHUNK_OVERLAP = 100;
/** 单文档最大体积（字节）：50MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * 文档模块服务：上传 + 异步解析 + 切片 + Embedding + 写 Qdrant。
 *
 * 流水线（processDocument，fire-and-forget，不阻塞上传响应）：
 *   parse → split → embed(得到 dim) → ensureCollection → 落 DocumentChunk → upsert Qdrant → completed
 *
 * 状态机（documents.parse_status）：
 *   pending → processing → completed | failed
 *
 * 注意：当前为进程内异步（未引入 BullMQ）。若未来需要横向扩展，
 * 只需把 processDocument 改成投递到队列即可，状态机与落库逻辑不变。
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly parsers: ParsersService,
    private readonly splitters: SplittersService,
    private readonly embeddings: EmbeddingsService,
    private readonly vectorStore: VectorStoreService,
  ) {
    // 确保落盘目录存在
    fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  }

  // ============================================================
  // 上传
  // ============================================================

  /**
   * 上传一个文件，落盘后创建 Document(pending)，并异步触发处理流水线。
   * @returns 新建的文档记录（此时状态为 pending，内容是异步处理的）
   */
  async upload(
    organizationId: string,
    userId: string,
    knowledgeBaseId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('上传文件为空');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `文件过大（${Math.round(file.size / 1024 / 1024)}MB），上限 50MB`,
      );
    }

    // 校验 KB 归属当前组织
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, organizationId },
    });
    if (!kb) throw new NotFoundException('知识库不存在');

    // 落盘：uploads/documents/<docId>__<sanitizedName>
    const docId = randomUUID();
    const safeName = this.sanitizeFileName(file.originalname || 'unnamed');
    const storagePath = path.join(UPLOAD_ROOT, `${docId}__${safeName}`);
    fs.writeFileSync(storagePath, file.buffer);

    const doc = await this.prisma.document.create({
      data: {
        id: docId,
        knowledgeBaseId,
        uploaderId: userId,
        name: safeName,
        originalName: file.originalname || safeName,
        mimeType: file.mimetype || 'application/octet-stream',
        size: file.size,
        // 复用 fileId 字段存逻辑存储路径（本项目未单独建 files 模块，落盘路径即真相源）
        fileId: storagePath,
        parseStatus: 'pending',
      },
    });

    // 异步处理（不阻塞响应）
    void this.processDocument(organizationId, userId, knowledgeBaseId, docId).catch(
      (err) => {
        this.logger.error(
          `processDocument 未捕获异常 docId=${docId}: ${err?.message || err}`,
        );
      },
    );

    return this.toDTO(doc);
  }

  // ============================================================
  // 异步处理流水线
  // ============================================================

  /**
   * 解析 → 切片 → Embedding → 落库 → 写向量库。
   * 任何阶段失败都落库 parse_status=failed + errorMessage。
   */
  async processDocument(
    organizationId: string,
    userId: string,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<void> {
    // 读取文档（乐观锁感：先标 processing）
    const doc = await this.prisma.document.findFirst({
      where: { id: documentId, knowledgeBaseId, knowledgeBase: { organizationId } },
    });
    if (!doc) {
      this.logger.warn(`processDocument 找不到文档 ${documentId}，跳过`);
      return;
    }

    await this.prisma.document.update({
      where: { id: documentId },
      data: { parseStatus: 'processing', errorMessage: null },
    });

    try {
      // 1) 读取落盘文件
      const storagePath = doc.fileId;
      if (!storagePath || !fs.existsSync(storagePath)) {
        throw new Error('原始文件丢失（落盘路径不存在）');
      }
      const buffer = fs.readFileSync(storagePath);

      // 2) 解析文本
      const parseResult = await this.parsers.parse(
        buffer,
        doc.mimeType,
        doc.originalName,
      );
      const fullText = (parseResult.text || '').trim();
      const pageCount = parseResult.pages?.length || 0;

      if (!fullText) {
        // 空文档：直接标记完成（0 切片）
        await this.prisma.document.update({
          where: { id: documentId },
          data: { parseStatus: 'completed', pageCount, chunkCount: 0 },
        });
        this.logger.warn(`文档 ${documentId} 解析后无文本，跳过切片`);
        return;
      }

      // 3) 切片（分页格式按页切，保留 pageNumber）
      const isPaged = ['pdf', 'pptx', 'xlsx'].includes(
        parseResult.metadata?.format,
      );
      const chunks: SplitterChunk[] = await this.splitters.split(
        parseResult.pages,
        {
          chunkSize: DEFAULT_CHUNK_SIZE,
          chunkOverlap: DEFAULT_CHUNK_OVERLAP,
          splitByPage: isPaged,
          useChineseSeparators: true,
        },
      );

      if (chunks.length === 0) {
        await this.prisma.document.update({
          where: { id: documentId },
          data: { parseStatus: 'completed', pageCount, chunkCount: 0 },
        });
        return;
      }

      // 4) 解析 embedding provider + 模型
      const kb = await this.prisma.knowledgeBase.findFirst({
        where: { id: knowledgeBaseId, organizationId },
      });
      if (!kb) throw new NotFoundException('知识库不存在');
      const providerId = await this.resolveEmbeddingProvider(
        organizationId,
        kb.embeddingProviderId,
        kb.embeddingModel,
      );

      // 5) 批量生成向量（自动批处理 + 重试）
      const embedding = await this.embeddings.embed(
        providerId,
        organizationId,
        kb.embeddingModel,
        chunks.map((c) => c.content),
        'db',
      );
      const vectors = embedding.vectors;
      if (!vectors || vectors.length !== chunks.length) {
        throw new Error(
          `Embedding 返回数量不一致：期望 ${chunks.length}，实际 ${vectors?.length}`,
        );
      }
      const dim = vectors[0].length;

      // 6) 确保 collection（用第一条向量的维度）
      await this.vectorStore.ensureCollection(knowledgeBaseId, dim);

      // 7) 落 DocumentChunk 并拿到 cuid，再用这些 id 构建向量点
      const created: Array<{ id: string; chunkIndex: number; pageNumber: number | null; content: string }> =
        [];
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const row = await this.prisma.documentChunk.create({
          data: {
            documentId,
            chunkIndex: c.chunkIndex,
            pageNumber: c.pageNumber || null,
            content: c.content,
            tokenCount: c.tokenCount || 0,
            metadata: {
              pageNumber: c.pageNumber || 1,
              organizationId,
              knowledgeBaseId,
            } as any,
          },
        });
        created.push({
          id: row.id,
          chunkIndex: c.chunkIndex,
          pageNumber: c.pageNumber || null,
          content: c.content,
        });
      }

      // 8) 批量 upsert 到向量库
      const points = created.map((row, i) => ({
        id: row.id,
        vector: vectors[i],
        payload: {
          organizationId,
          knowledgeBaseId,
          documentId,
          chunkIndex: row.chunkIndex,
          pageNumber: row.pageNumber ?? undefined,
          content: row.content,
        },
      }));
      await this.vectorStore.upsert(knowledgeBaseId, points);

      // 9) 标记完成
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          parseStatus: 'completed',
          pageCount,
          chunkCount: created.length,
        },
      });
      this.logger.log(
        `✅ 文档 ${documentId} 处理完成：${created.length} 切片，dim=${dim}，模型=${kb.embeddingModel}`,
      );
    } catch (err: any) {
      const msg = err?.message || String(err);
      this.logger.error(`❌ 文档 ${documentId} 处理失败: ${msg}`);
      // 失败也要把状态落库，方便前端展示 + 重试
      await this.prisma.document
        .update({
          where: { id: documentId },
          data: { parseStatus: 'failed', errorMessage: msg.slice(0, 500) },
        })
        .catch(() => undefined);
    }
  }

  /**
   * 解析 embedding provider：
   * - 若 KB 显式指定 embeddingProviderId 且属于当前组织 → 直接用；
   * - 否则按 organizationId + embeddingModel 动态选一个 active 的 LlmProvider。
   */
  private async resolveEmbeddingProvider(
    organizationId: string,
    explicitProviderId: string | null | undefined,
    model: string,
  ): Promise<string> {
    if (explicitProviderId) {
      const p = await this.prisma.llmProvider.findFirst({
        where: { id: explicitProviderId, organizationId, status: 'active' },
      });
      if (p) return p.id;
      this.logger.warn(
        `KB 指定的 embeddingProviderId=${explicitProviderId} 不可用，回退动态解析`,
      );
    }
    // 动态解析：取组织内 active 的 provider，优先类型匹配 model
    const candidates = await this.prisma.llmProvider.findMany({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'asc' },
    });
    if (candidates.length === 0) {
      throw new ForbiddenException(
        '当前组织没有可用的模型提供商，无法生成向量。请先添加模型提供商。',
      );
    }
    const lower = (model || '').toLowerCase();
    // MiniMax 模型（embo*）优先匹配 MiniMax provider
    const preferMiniMax = lower.includes('embo');
    const matched = candidates.find((c) =>
      preferMiniMax
        ? c.providerType === 'MiniMax'
        : c.providerType !== 'MiniMax',
    );
    return (matched || candidates[0]).id;
  }

  // ============================================================
  // 列表 / 详情
  // ============================================================

  async list(organizationId: string, knowledgeBaseId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: knowledgeBaseId, organizationId },
    });
    if (!kb) throw new NotFoundException('知识库不存在');

    const docs = await this.prisma.document.findMany({
      where: { knowledgeBaseId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        originalName: true,
        mimeType: true,
        size: true,
        parseStatus: true,
        pageCount: true,
        chunkCount: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return docs.map((d) => this.toDTO(d));
  }

  async detail(
    organizationId: string,
    knowledgeBaseId: string,
    documentId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId,
        knowledgeBase: { organizationId },
      },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    return this.toDTO(doc);
  }

  /**
   * 列出文档的全部切片（按 chunkIndex 排序）。
   * 用于前端「查看切片」抽屉，便于调试 / 验证解析结果。
   */
  async listChunks(
    organizationId: string,
    knowledgeBaseId: string,
    documentId: string,
  ) {
    // 复用 detail 校验 doc 归属
    await this.detail(organizationId, knowledgeBaseId, documentId);
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        chunkIndex: true,
        pageNumber: true,
        content: true,
        tokenCount: true,
        createdAt: true,
      },
    });
    return chunks;
  }

  // ============================================================
  // 下载（原始文件）
  // ============================================================

  /**
   * 解析下载所需的字段：校验 org + KB + 文档存在，并返回磁盘绝对路径 + 文件名 + mime。
   * 文件不在磁盘时抛 NotFoundException（前端可明确提示"原始文件丢失"）。
   *
   * 与 list/detail 不同：本方法返回 doc.fileId 绝对路径（而不是 toDTO 后的字段），
   * controller 用此路径做流式发送。
   */
  async resolveForDownload(
    organizationId: string,
    knowledgeBaseId: string,
    documentId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId,
        knowledgeBase: { organizationId },
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        mimeType: true,
        fileId: true,
      },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    if (!doc.fileId || !fs.existsSync(doc.fileId)) {
      throw new NotFoundException('原始文件丢失（可能已被清理）');
    }
    return {
      absPath: doc.fileId,
      fileName: doc.originalName || doc.name,
      mimeType: doc.mimeType || 'application/octet-stream',
    };
  }

  // ============================================================
  // 删除
  // ============================================================

  async remove(
    organizationId: string,
    knowledgeBaseId: string,
    documentId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId,
        knowledgeBase: { organizationId },
      },
    });
    if (!doc) throw new NotFoundException('文档不存在');

    // 1) 向量库：按 documentId 删所有点（best-effort）
    try {
      await this.vectorStore.deleteByDocument(knowledgeBaseId, documentId);
    } catch (err: any) {
      this.logger.warn(
        `删除向量点失败 docId=${documentId}: ${err?.message || err}`,
      );
    }

    // 2) 磁盘文件（best-effort，但失败时打 warn，不要静默吞错）
    if (doc.fileId && fs.existsSync(doc.fileId)) {
      try {
        fs.unlinkSync(doc.fileId);
      } catch (err: any) {
        this.logger.warn(
          `删除磁盘文件失败 docId=${documentId} fileId=${doc.fileId}: ${err?.message || err}`,
        );
      }
    }

    // 3) 数据库：Document + 级联 DocumentChunk（onDelete: Cascade）
    await this.prisma.document.delete({ where: { id: documentId } });
    return { success: true };
  }

  // ============================================================
  // 重试
  // ============================================================

  async retry(
    organizationId: string,
    userId: string,
    knowledgeBaseId: string,
    documentId: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        knowledgeBaseId,
        knowledgeBase: { organizationId },
      },
    });
    if (!doc) throw new NotFoundException('文档不存在');

    // 重置状态后重新触发流水线
    await this.prisma.document.update({
      where: { id: documentId },
      data: { parseStatus: 'pending', errorMessage: null },
    });
    void this.processDocument(
      organizationId,
      userId,
      knowledgeBaseId,
      documentId,
    ).catch((err) => {
      this.logger.error(`retry 未捕获异常 docId=${documentId}: ${err?.message}`);
    });
    return { success: true, id: documentId };
  }

  // ============================================================
  // 工具
  // ============================================================

  /** 文件名安全化：去掉路径分隔符与非法字符 */
  private sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 120);
  }

  /** 统一输出 DTO（把 parse_status / page_count / chunk_count 转驼峰） */
  private toDTO(d: any) {
    return {
      id: d.id,
      name: d.name,
      originalName: d.originalName,
      mimeType: d.mimeType,
      size: d.size,
      parseStatus: d.parseStatus,
      pageCount: d.pageCount,
      chunkCount: d.chunkCount,
      errorMessage: d.errorMessage,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }
}
