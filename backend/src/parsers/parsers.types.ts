/**
 * 解析器公共类型。
 *
 * 设计要点：
 * - 每页一个对象，PDF 这类分页格式填充 pageNumber；TXT/MD 这类不分页的则
 *   整个文档当作 pageNumber=1 的单页。
 * - metadata 字段透传 pageCount、sheetNames、author 等附加信息，调用方
 *   （splitter / 上传接口）按需使用。
 */
export interface ParsedPage {
  pageNumber: number; // 1-based
  text: string;
}

export interface ParseResult {
  mimeType: string;
  text: string; // 整篇纯文本（多页之间用 \n\n 分隔）
  pages: ParsedPage[];
  metadata: Record<string, any>;
}

/** 支持的 MIME 类型集合（白名单） */
export const SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/html',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

/**
 * 根据文件名（扩展名）猜测 MIME 类型。
 * 用于浏览器上传时未正确填写 Content-Type 的兜底。
 */
export function guessMimeTypeByExtension(name: string): string | null {
  const ext = (name.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'txt':
      return 'text/plain';
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return null;
  }
}