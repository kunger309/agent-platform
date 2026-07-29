import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ParsedPage } from '../parsers/parsers.types';

/**
 * 切片后的单块数据。
 * content: 切片文本
 * chunkIndex: 全局编号（从 0 开始），同一文档内递增
 * pageNumber: 该 chunk 来自哪一页（PDF/PPT 这种分页格式才有意义，
 *             TXT/MD/HTML 固定为 1）
 * tokenCount: 估算的 token 数（中英文混合，4 字符≈1 token 的经验值）
 * metadata: 调用方透传的附加信息（如 documentId）
 */
export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  pageNumber: number;
  tokenCount: number;
  metadata?: Record<string, any>;
}

export interface SplitOptions {
  /** 每片最大字符数（默认 800）；CJK 字符按 1 字符算 */
  chunkSize?: number;
  /** 相邻片重叠字符数（默认 100）；用于保留跨段上下文 */
  chunkOverlap?: number;
  /** 是否按页分别切（PDF/PPT 适用）；false 则整段连接后切 */
  splitByPage?: boolean;
  /** 中文优先分隔符（标题/段落/句号等） */
  useChineseSeparators?: boolean;
}

/**
 * 文本切片服务：基于 @langchain/textsplitters。
 *
 * 设计要点：
 * - 按"页"切（PDF/PPT）：保留 pageNumber 字段，方便后续做"按页定位"高亮
 * - 整篇切（TXT/MD/HTML）：更快，分隔符更激进
 * - 默认参数 chunkSize=800 / overlap=100，适合中文段落级召回
 */
@Injectable()
export class SplittersService {
  private readonly logger = new Logger(SplittersService.name);

  /** 中文优先分隔符（按优先级匹配） */
  private readonly zhSeparators = [
    '\n\n', // 段落
    '\n',
    '。',
    '！',
    '？',
    '；',
    '，',
    '、',
    ' ',
    '',
  ];

  /** 通用（英文/代码块友好）分隔符 */
  private readonly enSeparators = [
    '\n\n',
    '\n',
    '. ',
    '? ',
    '! ',
    '; ',
    ': ',
    ', ',
    ' ',
    '',
  ];

  /**
   * 入口：根据解析后的 pages 切片成 DocumentChunk[]。
   */
  async split(
    pages: ParsedPage[],
    options: SplitOptions = {},
  ): Promise<DocumentChunk[]> {
    const {
      chunkSize = 800,
      chunkOverlap = 100,
      splitByPage = false,
      useChineseSeparators = true,
    } = options;

    if (chunkSize <= 0) {
      throw new BadRequestException('chunkSize 必须 > 0');
    }
    if (chunkOverlap < 0 || chunkOverlap >= chunkSize) {
      throw new BadRequestException('chunkOverlap 必须 < chunkSize');
    }
    if (pages.length === 0) {
      return [];
    }

    const separators = useChineseSeparators
      ? this.zhSeparators
      : this.enSeparators;

    // 全文档为空 → 早退
    const fullText = pages.map((p) => p.text).join('\n\n').trim();
    if (!fullText) {
      this.logger.warn('文档解析后无文本，跳过切片');
      return [];
    }

    if (splitByPage) {
      return this.splitByPage(pages, {
        chunkSize,
        chunkOverlap,
        separators,
      });
    }

    return this.splitAsWhole(fullText, pages[0].pageNumber, {
      chunkSize,
      chunkOverlap,
      separators,
    });
  }

  /** 按页切：每页单独建 splitter，chunkIndex 跨页连续 */
  private async splitByPage(
    pages: ParsedPage[],
    opts: {
      chunkSize: number;
      chunkOverlap: number;
      separators: string[];
    },
  ): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    let chunkIndex = 0;
    for (const page of pages) {
      const text = (page.text || '').trim();
      if (!text) continue;
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: opts.chunkSize,
        chunkOverlap: opts.chunkOverlap,
        separators: opts.separators,
      });
      const parts = await splitter.splitText(text);
      for (const part of parts) {
        const content = part.trim();
        if (!content) continue;
        chunks.push({
          content,
          chunkIndex,
          pageNumber: page.pageNumber,
          tokenCount: this.estimateTokens(content),
        });
        chunkIndex++;
      }
    }
    return chunks;
  }

  /** 整篇切：把多页拼接后一次性切片，pageNumber 用第 1 页 */
  private async splitAsWhole(
    text: string,
    fallbackPageNumber: number,
    opts: {
      chunkSize: number;
      chunkOverlap: number;
      separators: string[];
    },
  ): Promise<DocumentChunk[]> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: opts.chunkSize,
      chunkOverlap: opts.chunkOverlap,
      separators: opts.separators,
    });
    const parts = await splitter.splitText(text);
    const chunks: DocumentChunk[] = [];
    parts.forEach((part, idx) => {
      const content = part.trim();
      if (!content) return;
      chunks.push({
        content,
        chunkIndex: idx,
        pageNumber: fallbackPageNumber,
        tokenCount: this.estimateTokens(content),
      });
    });
    return chunks;
  }

  /**
   * Token 估算（粗略）：英文 1 字符≈1/4 token，CJK 1 字符≈1 token。
   * 实际 embedding 调用会以真实模型 token 数为准，这里只用于预算/告警。
   */
  private estimateTokens(text: string): number {
    let ascii = 0;
    let cjk = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0) || 0;
      // 0x4E00..0x9FFF + 0x3400..0x4DBF 是基本 CJK + 扩展 A
      if (
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3400 && code <= 0x4dbf)
      ) {
        cjk++;
      } else {
        ascii++;
      }
    }
    return Math.ceil(cjk + ascii / 4);
  }
}