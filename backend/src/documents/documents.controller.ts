import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Request,
  Res,
  UploadedFile,
  UseInterceptors,
  Body,
  HttpCode,
  ParseIntPipe,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { RequirePermission } from '../common/decorators/require-permission.decorator';

/**
 * 文档管理：挂在知识库路由下 /api/knowledge-bases/:kbId/documents
 *
 * 权限：
 * - 列表 / 详情：kb:list（文档是 KB 子资源，读权限复用 KB 读）
 * - 上传 / 重试：document:upload
 * - 删除：kb:delete（删除文档属 KB 管理动作）
 */
@Controller('knowledge-bases/:kbId/documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Post()
  @RequirePermission('document:upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  @HttpCode(201)
  async upload(
    @Param('kbId') kbId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) throw new BadRequestException('未收到文件（字段名应为 file）');
    // ★ 修复中文文件名乱码：Multer 默认按 latin1 解读 multipart 里的 filename 字段，
    //   但浏览器发的是 UTF-8 字节序列（中文会被解码成 "开`W'ˋ" 这种乱码）。
    //   把它当作 Buffer 拉回字节，再按 UTF-8 重新解码。
    //   ASCII 文件名不受影响（latin1 单字节等于 UTF-8 单字节）。
    const originalname = file.originalname
      ? Buffer.from(file.originalname, 'latin1').toString('utf8')
      : file.originalname;
    const data = await this.docs.upload(
      req.user.currentOrgId,
      req.user.userId,
      kbId,
      {
        buffer: file.buffer,
        originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
    );
    return { success: true, data };
  }

  @Get()
  @RequirePermission('kb:list')
  async list(@Param('kbId') kbId: string, @Request() req: any) {
    const data = await this.docs.list(req.user.currentOrgId, kbId);
    return { success: true, data };
  }

  @Get(':docId')
  @RequirePermission('kb:list')
  async detail(
    @Param('kbId') kbId: string,
    @Param('docId') docId: string,
    @Request() req: any,
  ) {
    const data = await this.docs.detail(req.user.currentOrgId, kbId, docId);
    return { success: true, data };
  }

  @Get(':docId/chunks')
  @RequirePermission('kb:list')
  async listChunks(
    @Param('kbId') kbId: string,
    @Param('docId') docId: string,
    @Request() req: any,
  ) {
    const data = await this.docs.listChunks(
      req.user.currentOrgId,
      kbId,
      docId,
    );
    return { success: true, data };
  }

  /**
   * 下载文档原文件（不切片、不解析，整文件流式回传）。
   * 权限同 KB 读：kb:list。
   * 中文文件名靠 Express res.download 自动用 RFC 5987 编码（filename*=UTF-8''...）。
   */
  @Get(':docId/download')
  @RequirePermission('kb:list')
  async download(
    @Param('kbId') kbId: string,
    @Param('docId') docId: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { absPath, fileName } = await this.docs.resolveForDownload(
      req.user.currentOrgId,
      kbId,
      docId,
    );
    // res.download 会自动设置 Content-Type、Content-Disposition（含 RFC 5987 编码）、
    // 处理 Range 请求 / 304 缓存等。callback 兜底异常。
    res.download(absPath, fileName, (err) => {
      if (err && !res.headersSent) {
        // ★ 注意：Nest 用 @Res() 时它不会自动接管 res 生命周期，
        //   callback 里只处理"还没开始发送"的错误；已经开始流的让连接自然断开。
        res
          .status(500)
          .json({ success: false, message: '下载失败：' + (err?.message || err) });
      }
    });
  }

  @Post(':docId/retry')
  @RequirePermission('document:upload')
  @HttpCode(200)
  async retry(
    @Param('kbId') kbId: string,
    @Param('docId') docId: string,
    @Request() req: any,
  ) {
    const data = await this.docs.retry(
      req.user.currentOrgId,
      req.user.userId,
      kbId,
      docId,
    );
    return { success: true, data };
  }

  @Delete(':docId')
  @RequirePermission('kb:delete')
  @HttpCode(200)
  async remove(
    @Param('kbId') kbId: string,
    @Param('docId') docId: string,
    @Request() req: any,
  ) {
    const data = await this.docs.remove(req.user.currentOrgId, kbId, docId);
    return { success: true, data };
  }
}
