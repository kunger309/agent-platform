import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import {
  ParseResult,
  ParsedPage,
  SUPPORTED_MIME_TYPES,
  SupportedMimeType,
  guessMimeTypeByExtension,
} from './parsers.types';

/**
 * 文档解析器：MIME 路由 + 多格式文本提取。
 *
 * 输入：文件 Buffer + MIME 类型 + 可选原始文件名。
 * 输出：纯文本 + 分页结构 + 元数据。
 *
 * 为什么不接 unoconv / libreoffice 之类重型依赖：
 * - .doc / .xls / .ppt 这类老格式用户极少（前端可拒收或转换）；
 * - 大多数企业 KB 数据是 PDF / DOCX / MD / TXT，覆盖这 4 类即满足 90% 场景；
 * - 后续如果需要 OCR 表格识别，再独立加 task。
 */
@Injectable()
export class ParsersService {
  private readonly logger = new Logger(ParsersService.name);

  /**
   * 入口：根据 MIME 路由到对应解析器。
   * mimeType 为空时按文件名扩展名兜底；都不在白名单 → 400。
   */
  async parse(
    buffer: Buffer,
    mimeType?: string,
    originalName?: string,
  ): Promise<ParseResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('文件内容为空');
    }

    // MIME 兜底：浏览器有时会把 docx 当 application/octet-stream 上传
    let mime = (mimeType || '').toLowerCase();
    if (!mime || !SUPPORTED_MIME_TYPES.includes(mime as SupportedMimeType)) {
      const guessed = originalName
        ? guessMimeTypeByExtension(originalName)
        : null;
      if (guessed) {
        this.logger.warn(
          `MIME ${mimeType} 不在白名单，按文件名 ${originalName} 推断为 ${guessed}`,
        );
        mime = guessed;
      } else {
        throw new BadRequestException(
          `不支持的文件类型: ${mimeType || '未知'}${
            originalName ? ` (${originalName})` : ''
          }`,
        );
      }
    }

    switch (mime as SupportedMimeType) {
      case 'text/plain':
      case 'text/markdown':
        return this.parseText(buffer, mime as SupportedMimeType);
      case 'text/html':
        return this.parseHtml(buffer);
      case 'application/pdf':
        return this.parsePdf(buffer);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.parseDocx(buffer);
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        return this.parseXlsx(buffer);
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        return this.parsePptx(buffer);
      default:
        throw new BadRequestException(`暂未实现的解析器: ${mime}`);
    }
  }

  // ============================================================
  // 各格式实现
  // ============================================================

  /** 纯文本 / Markdown：直接 UTF-8 解码 */
  private async parseText(
    buffer: Buffer,
    mime: SupportedMimeType,
  ): Promise<ParseResult> {
    // 简单 BOM 剥离
    let text = buffer.toString('utf-8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const format = mime === 'text/markdown' ? 'markdown' : 'text';
    return {
      mimeType: mime,
      text,
      pages: [{ pageNumber: 1, text }],
      metadata: { format, charCount: text.length },
    };
  }

  /** HTML：剥离标签保留文本结构。简单实现，不引入 cheerio 以减少依赖。 */
  private async parseHtml(buffer: Buffer): Promise<ParseResult> {
    let html = buffer.toString('utf-8');
    if (html.charCodeAt(0) === 0xfeff) html = html.slice(1);

    // 先把块级标签转换为换行（script/style 内容直接丢）
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)\s*>/gi, '\n');
    html = html.replace(/<br\s*\/?>/gi, '\n');

    // 剥剩余标签
    const text = html
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      mimeType: 'text/html',
      text,
      pages: [{ pageNumber: 1, text }],
      metadata: { format: 'html', charCount: text.length },
    };
  }

  /** PDF：使用 pdf-parse（基于 pdfjs-dist）。返回分页结构便于按页切片。 */
  private async parsePdf(buffer: Buffer): Promise<ParseResult> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const pages: ParsedPage[] = result.pages.map((p) => ({
        pageNumber: p.num,
        text: p.text,
      }));
      // 全文 = 各页用双换行连接，保留原分页
      const text = pages
        .map((p) => p.text)
        .join('\n\n')
        .trim();
      return {
        mimeType: 'application/pdf',
        text,
        pages,
        metadata: {
          format: 'pdf',
          pageCount: result.total,
          charCount: text.length,
        },
      };
    } finally {
      // pdf-parse 内部用 worker，必须 destroy 释放
      await parser.destroy().catch(() => undefined);
    }
  }

  /** DOCX：mammoth.extractRawText 输出纯文本（不含图片描述） */
  private async parseDocx(buffer: Buffer): Promise<ParseResult> {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || '').trim();
    // mammoth 没有"页"概念，但段落以 \n 分隔；强插一个 pageNumber=1
    return {
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      text,
      pages: [{ pageNumber: 1, text }],
      metadata: {
        format: 'docx',
        charCount: text.length,
        warnings: (result.messages || []).map((m) => m.message).slice(0, 20),
      },
    };
  }

  /** XLSX：把每个 sheet 转为 CSV 文本，sheet 间用 \n\n-- <name> --\n\n 分隔 */
  private async parseXlsx(buffer: Buffer): Promise<ParseResult> {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetParts: string[] = [];
    const sheetNames: string[] = [];
    for (const name of wb.SheetNames) {
      sheetNames.push(name);
      const ws = wb.Sheets[name];
      // 用 csv 而非 html，避免注入 HTML 标签到切片中
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      sheetParts.push(`# Sheet: ${name}\n${csv}`);
    }
    const text = sheetParts.join('\n\n').trim();
    // 每个 sheet 视为 1 页
    const pages: ParsedPage[] = sheetNames.map((name, i) => ({
      pageNumber: i + 1,
      text: sheetParts[i] || '',
    }));
    return {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      text,
      pages,
      metadata: {
        format: 'xlsx',
        sheetCount: sheetNames.length,
        sheetNames,
        charCount: text.length,
      },
    };
  }

  /**
   * PPTX：用 JSZip 解压，遍历 ppt/slides/slideN.xml，
   * 提取 <a:t> 文本节点（PowerPoint 的标准文本节点）。
   */
  private async parsePptx(buffer: Buffer): Promise<ParseResult> {
    const zip = await JSZip.loadAsync(buffer);
    // 找出所有 slideN.xml
    const slideFiles = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml/)![1], 10);
        const nb = parseInt(b.match(/slide(\d+)\.xml/)![1], 10);
        return na - nb;
      });

    const pages: ParsedPage[] = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.files[slideFiles[i]].async('string');
      // 抽取 <a:t>...</a:t> 内文本，忽略属性
      const texts: string[] = [];
      const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const decoded = m[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
        texts.push(decoded);
      }
      pages.push({
        pageNumber: i + 1,
        text: texts.join('\n').trim(),
      });
    }

    const text = pages.map((p) => p.text).join('\n\n').trim();
    return {
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      text,
      pages,
      metadata: {
        format: 'pptx',
        slideCount: pages.length,
        charCount: text.length,
      },
    };
  }
}