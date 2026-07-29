// 生成 6 种格式的样本文件，给 parsers + splitters 端到端测试用。
import { PDFParse } from 'pdf-parse';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import JSZip from 'jszip';

const OUT = new URL('../test-samples/', import.meta.url);
mkdirSync(OUT, { recursive: true });

// 1) TXT
writeFileSync(
  new URL('hello.txt', OUT),
  '第一行：你好世界。\n第二行：This is a sample text.\n第三行：用于测试 parsers + splitters。\n',
);

// 2) MD
writeFileSync(
  new URL('readme.md', OUT),
  `# 项目说明

## 章节 1

这是第一段，介绍项目背景。本项目是一个 AI Agent 平台，支持知识库检索。

## 章节 2

第二段，介绍架构。前端使用 Vue 3，后端使用 NestJS。

代码示例：

\`\`\`ts
const x = 1;
\`\`\`
`,
);

// 3) HTML
writeFileSync(
  new URL('page.html', OUT),
  `<!doctype html>
<html><head><title>测试</title></head>
<body>
  <script>alert('ignore')</script>
  <h1>标题</h1>
  <p>第一段 HTML 文本。</p>
  <div>
    <h2>子标题</h2>
    <p>第二段：包含 <strong>加粗</strong> 和 <em>斜体</em>。</p>
  </div>
</body></html>
`,
);

// 4) PDF —— 直接构造最小 PDF
const pdfText = `PDF 测试文档

第一页内容：用于解析测试。

第二页模拟：本文档由脚本生成。`;

const pdfBuffer = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj
4 0 obj<</Length 100>>stream
BT /F1 12 Tf 50 750 Td (${pdfText.replace(/\n/g, ') Tj 0 -15 Td (')}) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000053 00000 n
0000000097 00000 n
0000000206 00000 n
trailer<</Size 5/Root 1 0 R>>
startxref
356
%%EOF`,
);
writeFileSync(new URL('sample.pdf', OUT), pdfBuffer);

// 5) DOCX：用 mammoth 把纯 markdown 风格的纯文本写入 .docx? mammoth 是读 docx 的
// 改用 docx 包？不，依赖里没装。改用 zip+xml 手搓（mini docx）。
const docxXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>DOCX 测试段落第一行。</w:t></w:r></w:p>
<w:p><w:r><w:t>第二段：包含中文和 English mixed content.</w:t></w:r></w:p>
<w:p><w:r><w:t>第三段用于切片测试。</w:t></w:r></w:p>
</w:body>
</w:document>`;

// 手搓 docx（zip 内至少有 [Content_Types].xml, _rels, word/document.xml）
async function makeDocx() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file('word/document.xml', docxXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}
const docxBuf = await makeDocx();
writeFileSync(new URL('sample.docx', OUT), docxBuf);

// 6) XLSX：xlsx 包支持直接写（用 file:// 绝对路径）
const wb = XLSX.utils.book_new();
const ws1 = XLSX.utils.aoa_to_sheet([
  ['姓名', '年龄', '城市'],
  ['张三', 28, '北京'],
  ['李四', 35, '上海'],
  ['王五', 42, '深圳'],
]);
const ws2 = XLSX.utils.aoa_to_sheet([
  ['产品', '销量', '单价'],
  ['A', 100, 9.9],
  ['B', 200, 19.9],
]);
XLSX.utils.book_append_sheet(wb, ws1, '人员');
XLSX.utils.book_append_sheet(wb, ws2, '销售');
const xlsxPath = new URL('sample.xlsx', OUT).pathname.replace(/^\//, '');
XLSX.writeFile(wb, xlsxPath);

// 7) PPTX：手搓 zip + ppt/slides/slideN.xml
async function makePptx() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
</p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`,
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody>
<a:p><a:r><a:t>PPT 第一页标题</a:t></a:r></a:p>
<a:p><a:r><a:t>内容：用于解析测试</a:t></a:r></a:p>
</p:txBody></p:sp>
</p:spTree></p:cSld>
</p:sld>`,
  );
  zip.file(
    'ppt/slides/slide2.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:txBody>
<a:p><a:r><a:t>第二页：另一段文本</a:t></a:r></a:p>
</p:txBody></p:sp>
</p:spTree></p:cSld>
</p:sld>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
const pptxBuf = await makePptx();
writeFileSync(new URL('sample.pptx', OUT), pptxBuf);

console.log('✅ 7 个样本文件已生成到 backend/test-samples/');