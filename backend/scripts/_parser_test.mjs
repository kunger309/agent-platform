// parsers + splitters 端到端测试
// 直接用编译后的 JS（dist/src/parsers/parsers.service.js）
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SAMPLES = join(__dirname, '..', 'test-samples');

const { ParsersService } = await import(
  '../dist/src/parsers/parsers.service.js'
);
const { SplittersService } = await import(
  '../dist/src/splitters/splitters.service.js'
);

const parsers = new ParsersService();
const splitters = new SplittersService();

let pass = 0,
  fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fail++;
    console.log(`  ❌ ${msg}`);
  }
}

// ============================================
// 用例 1: TXT
// ============================================
console.log('\n[1] TXT');
{
  const buf = readFileSync(join(SAMPLES, 'hello.txt'));
  const result = await parsers.parse(buf, 'text/plain', 'hello.txt');
  assert(result.mimeType === 'text/plain', `mimeType=${result.mimeType}`);
  assert(result.text.includes('你好世界'), 'contains 你好世界');
  assert(result.text.includes('This is a sample text'), 'contains English');
  assert(result.pages.length === 1, `pages=1 (got ${result.pages.length})`);
  const chunks = await splitters.split(result.pages, {
    chunkSize: 100,
    chunkOverlap: 10,
  });
  assert(chunks.length >= 1, `split chunks=${chunks.length}`);
  assert(chunks.every((c) => c.tokenCount > 0), 'all chunks have tokenCount');
}

// ============================================
// 用例 2: MD
// ============================================
console.log('\n[2] Markdown');
{
  const buf = readFileSync(join(SAMPLES, 'readme.md'));
  const result = await parsers.parse(buf, 'text/markdown', 'readme.md');
  assert(result.mimeType === 'text/markdown', `mimeType=${result.mimeType}`);
  assert(result.text.includes('项目说明'), 'contains 项目说明');
  assert(result.text.includes('Vue 3'), 'contains Vue 3');
  assert(result.text.includes('const x = 1'), 'contains code block');
  // MD 的代码块标记 ``` 在 chunk 里保留（属于 source 原文，不剥）
  assert(result.text.includes('```ts'), 'contains ts code fence');
  const chunks = await splitters.split(result.pages, {
    chunkSize: 80,
    chunkOverlap: 10,
  });
  assert(chunks.length >= 2, `split chunks=${chunks.length} (>=2)`);
  console.log(
    `     分片预览: chunk0="${chunks[0].content.slice(0, 30)}..."`,
  );
}

// ============================================
// 用例 3: HTML
// ============================================
console.log('\n[3] HTML');
{
  const buf = readFileSync(join(SAMPLES, 'page.html'));
  const result = await parsers.parse(buf, 'text/html', 'page.html');
  assert(result.mimeType === 'text/html', `mimeType=${result.mimeType}`);
  assert(!result.text.includes('<script>'), 'script tag stripped');
  assert(!result.text.includes('alert('), 'script content stripped');
  assert(!result.text.includes('<h1>'), 'html tags stripped');
  assert(result.text.includes('标题'), 'contains 标题');
  assert(result.text.includes('加粗'), 'contains 加粗');
  const chunks = await splitters.split(result.pages);
  assert(chunks.length >= 1, `split chunks=${chunks.length}`);
}

// ============================================
// 用例 4: PDF（用 pageJoiner 关闭 → 单 page 也能切）
// ============================================
console.log('\n[4] PDF');
{
  const buf = readFileSync(join(SAMPLES, 'sample.pdf'));
  const result = await parsers.parse(buf, 'application/pdf', 'sample.pdf');
  assert(result.mimeType === 'application/pdf', `mimeType=${result.mimeType}`);
  assert(result.pages.length >= 1, `pages>=1 (got ${result.pages.length})`);
  console.log(
    `     PDF 共 ${result.pages.length} 页，全文 ${result.text.length} 字`,
  );
  // PDF 按页切
  const chunksByPage = await splitters.split(result.pages, {
    splitByPage: true,
    chunkSize: 100,
    chunkOverlap: 20,
  });
  assert(chunksByPage.length >= 1, `splitByPage chunks=${chunksByPage.length}`);
  // 整篇切
  const chunksWhole = await splitters.split(result.pages, {
    splitByPage: false,
    chunkSize: 100,
    chunkOverlap: 20,
  });
  assert(chunksWhole.length >= 1, `splitAsWhole chunks=${chunksWhole.length}`);
}

// ============================================
// 用例 5: DOCX
// ============================================
console.log('\n[5] DOCX');
{
  const buf = readFileSync(join(SAMPLES, 'sample.docx'));
  const result = await parsers.parse(
    buf,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'sample.docx',
  );
  assert(
    result.mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    `mimeType=${result.mimeType}`,
  );
  assert(result.text.includes('DOCX 测试段落第一行'), 'contains DOCX content');
  assert(result.text.includes('English mixed content'), 'contains English');
  assert(result.pages.length === 1, `pages=1`);
  const chunks = await splitters.split(result.pages, {
    chunkSize: 30,
    chunkOverlap: 5,
  });
  assert(chunks.length >= 2, `split chunks=${chunks.length} (>=2)`);
}

// ============================================
// 用例 6: XLSX
// ============================================
console.log('\n[6] XLSX');
{
  const buf = readFileSync(join(SAMPLES, 'sample.xlsx'));
  const result = await parsers.parse(
    buf,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'sample.xlsx',
  );
  assert(
    result.mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    `mimeType=${result.mimeType}`,
  );
  assert(result.text.includes('Sheet: 人员'), 'contains Sheet: 人员');
  assert(result.text.includes('张三'), 'contains 张三');
  assert(result.text.includes('Sheet: 销售'), 'contains Sheet: 销售');
  assert(result.pages.length === 2, `pages=2 sheets (got ${result.pages.length})`);
  assert(result.metadata.sheetNames?.length === 2, 'metadata sheetNames=2');
  const chunks = await splitters.split(result.pages, {
    chunkSize: 80,
    chunkOverlap: 10,
  });
  assert(chunks.length >= 2, `split chunks=${chunks.length}`);
}

// ============================================
// 用例 7: PPTX
// ============================================
console.log('\n[7] PPTX');
{
  const buf = readFileSync(join(SAMPLES, 'sample.pptx'));
  const result = await parsers.parse(
    buf,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'sample.pptx',
  );
  assert(
    result.mimeType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    `mimeType=${result.mimeType}`,
  );
  assert(result.pages.length === 2, `pages=2 slides (got ${result.pages.length})`);
  assert(result.text.includes('PPT 第一页标题'), 'contains slide1 text');
  assert(result.text.includes('第二页'), 'contains slide2 text');
  const chunks = await splitters.split(result.pages, {
    splitByPage: true,
    chunkSize: 50,
    chunkOverlap: 10,
  });
  assert(chunks.length >= 2, `splitByPage chunks=${chunks.length}`);
  // 验证 pageNumber 透传
  assert(
    chunks.some((c) => c.pageNumber === 2),
    'chunk has pageNumber=2 from slide2',
  );
}

// ============================================
// 用例 8: 不支持的 MIME
// ============================================
console.log('\n[8] 不支持的类型 → 抛错');
{
  try {
    await parsers.parse(Buffer.from('x'), 'application/zip', 'x.zip');
    fail++;
    console.log('  ❌ 应该抛 BadRequestException');
  } catch (err) {
    if (err.name === 'BadRequestException' || err.status === 400) {
      pass++;
      console.log('  ✅ 正确抛 BadRequestException');
    } else {
      fail++;
      console.log(`  ❌ 错误类型不对: ${err.message}`);
    }
  }
}

// ============================================
// 用例 9: MIME 兜底（octet-stream + 文件名）
// ============================================
console.log('\n[9] MIME 兜底：octet-stream 但文件名是 .pdf');
{
  const buf = readFileSync(join(SAMPLES, 'sample.pdf'));
  const result = await parsers.parse(buf, 'application/octet-stream', 'sample.pdf');
  assert(result.mimeType === 'application/pdf', '按文件名兜底为 PDF');
}

// ============================================
// 用例 10: 大文本切片 - 边界
// ============================================
console.log('\n[10] 大文本 chunkSize=200 中文优先分隔');
{
  // 拼一段 2000 字中文
  const bigText = Array(300)
    .fill('这是测试句子。')
    .join('\n\n');
  const result = await parsers.parse(
    Buffer.from(bigText),
    'text/plain',
    'big.txt',
  );
  const chunks = await splitters.split(result.pages, {
    chunkSize: 200,
    chunkOverlap: 30,
  });
  console.log(
    `     ${bigText.length} 字 → ${chunks.length} chunks, avg ${Math.round(
      bigText.length / chunks.length,
    )} 字/chunk`,
  );
  assert(chunks.length >= 5, `chunks>=5 (got ${chunks.length})`);
  assert(
    chunks.every((c) => c.content.length <= 250),
    'all chunks <= chunkSize + tolerance',
  );
}

console.log(`\n========================================`);
console.log(`✅ ${pass} passed, ❌ ${fail} failed`);
console.log(`========================================`);
process.exit(fail > 0 ? 1 : 0);