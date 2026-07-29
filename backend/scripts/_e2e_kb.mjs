/**
 * #61 Phase 3 端到端验证：建 KB → 多格式上传 → 异步解析/索引 → 跨格式检索命中 → 清理。
 *
 * 覆盖格式：TXT / MD / HTML / XLSX(真实，经 xlsx 库生成) / PDF(手工最小结构，含 UTF-16BE 文本) /
 *           DOCX(真实文件，自带文本：DOCX 测试段落第一行 / 中文和 English mixed content / 切片测试)。
 * 用 curl 做 multipart 上传（字段名 file，最稳），其余用 fetch。
 *
 * 用法（在 backend 目录运行）：
 *   node scripts/_e2e_kb.mjs
 */
import { execSync } from 'node:child_process';
import { copyFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const BASE = 'http://localhost:3000/api';
const NODE = '/c/Users/liukun/.workbuddy/binaries/node/versions/22.22.2/node.exe';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const XLSX = createRequire(import.meta.url)(
  path.join(__dirname, '..', 'node_modules', 'xlsx', 'xlsx.mjs'),
);

const log = (...a) => console.log(...a);
const ok = (m) => log('  ✓', m);

/** 生成最小可用 PDF：一页 + Helvetica 字体 + UTF-16BE(BOM) 十六进制文本串 */
function buildPdf(text) {
  const hex =
    'FEFF' +
    [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const stream = `BT /F1 14 Tf 50 750 Td <${hex}> Tj ET`;
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  objs[4] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  pdf += xref;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

async function uploadCurl(token, kbId, file, mime, filename) {
  const out = execSync(
    `curl -s -m 30 -X POST "${BASE}/knowledge-bases/${kbId}/documents" ` +
      `-H "Authorization: Bearer ${token}" ` +
      `-F "file=@${file};type=${mime};filename=${filename}"`,
    { encoding: 'utf8' },
  );
  return JSON.parse(out).data;
}

async function getDoc(token, kbId, docId) {
  return fetch(`${BASE}/knowledge-bases/${kbId}/documents/${docId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json()).then((j) => j.data);
}

async function main() {
  // 1) 登录
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  }).then((r) => r.json());
  const token = login.data.accessToken;
  log('✓ 登录成功 (orgId=', login.data.currentOrgId, ')');

  // 2) 建 KB（embo-01 = MiniMax embedding）
  const kbRes = await fetch(`${BASE}/knowledge-bases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-kb-' + Date.now(),
      description: 'Phase3 多格式端到端验证',
      embeddingModel: 'embo-01',
    }),
  }).then((r) => r.json());
  const kbId = kbRes.data.id;
  log('✓ 创建 KB:', kbId);

  // 3) 准备多格式样本文件
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-kb-'));

  const files = [];
  // TXT：预算制度
  const txt = path.join(dir, '预算制度.txt');
  writeFileSync(
    txt,
    '公司年度预算审批流程如下：各部门在每年十一月提交下一年度预算草案，' +
      '由部门经理初审后送交财务部复核，财务总监终审签字后方可执行。' +
      '超过一百万元的资本支出还需董事会批准。',
    'utf8',
  );
  files.push({ file: txt, mime: 'text/plain', name: '预算制度.txt', fmt: 'TXT' });

  // MD：报销制度
  const md = path.join(dir, '报销制度.md');
  writeFileSync(
    md,
    '# 报销管理制度\n\n员工日常报销需填写报销单，由直属主管审批。\n' +
      '单笔金额超过五千元需部门总监加签。\n差旅费报销须附行程单与发票，由财务复核后打款。',
    'utf8',
  );
  files.push({ file: md, mime: 'text/markdown', name: '报销制度.md', fmt: 'MD' });

  // HTML：考勤制度
  const html = path.join(dir, '考勤制度.html');
  writeFileSync(
    html,
    '<html><body><h1>考勤制度</h1><p>员工每月迟到三次记口头警告，五次记书面警告。' +
      '年假天数按工龄计算，满一年享五天，每增一年加一天。</p></body></html>',
    'utf8',
  );
  files.push({ file: html, mime: 'text/html', name: '考勤制度.html', fmt: 'HTML' });

  // XLSX：产品清单（真实文件，经 xlsx 库生成）
  const xlsxPath = path.join(dir, '产品清单.xlsx');
  const ws = XLSX.utils.aoa_to_sheet([
    ['产品名称', '单价(元)', '说明'],
    ['智能客服系统', 98000, '含一年运维'],
    ['知识库检索模块', 45000, '支持向量+BM25混合检索'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '产品');
  writeFileSync(xlsxPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  files.push({
    file: xlsxPath,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    name: '产品清单.xlsx',
    fmt: 'XLSX',
  });

  // PDF：差旅报销规定（手工最小结构；用英文内容以保证可被 pdf-parse 正确抽取，
  //       真实中文 PDF 由 Word/Adobe 产出、自带字体+ToUnicode，平台 pdf-parse 亦可正确抽取）
  const pdfPath = path.join(dir, '差旅报销规定.pdf');
  writeFileSync(
    pdfPath,
    buildPdf(
      'Business travel reimbursement must be submitted within thirty days after the trip, ' +
        'and reviewed by the line manager and finance team before payment.',
    ),
  );
  files.push({ file: pdfPath, mime: 'application/pdf', name: '差旅报销规定.pdf', fmt: 'PDF' });

  // DOCX：复用项目自带测试样本（mammoth 已能在后端正确抽取其文本内容）
  //       文本关键短语：「DOCX 测试段落第一行」「中文和 English mixed content」「切片测试」
  const docxSrc = path.join(__dirname, '..', 'test-samples', 'sample.docx');
  const docxPath = path.join(dir, '技术文档示例.docx');
  copyFileSync(docxSrc, docxPath);
  files.push({
    file: docxPath,
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    name: '技术文档示例.docx',
    fmt: 'DOCX',
  });

  // 4) 批量上传
  const docs = [];
  for (const f of files) {
    const d = await uploadCurl(token, kbId, f.file, f.mime, f.name);
    docs.push({ ...f, id: d.id, status: d.parseStatus });
    log(`✓ 上传 [${f.fmt}] ${f.name} → doc ${d.id}`);
  }

  // 5) 轮询所有文档直到完成/失败（最多 ~90s）
  log('· 等待解析/索引完成...');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    let allDone = true;
    for (const d of docs) {
      if (d.status === 'completed' || d.status === 'failed') continue;
      const cur = await getDoc(token, kbId, d.id);
      d.status = cur.parseStatus;
      d.chunkCount = cur.chunkCount;
      d.errorMessage = cur.errorMessage;
      if (d.status !== 'completed' && d.status !== 'failed') allDone = false;
    }
    if (allDone) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  for (const d of docs) {
    if (d.status === 'completed') ok(`[${d.fmt}] ${d.name} 完成，切片=${d.chunkCount}`);
    else log(`  ✗ [${d.fmt}] ${d.name} 状态=${d.status} ${d.errorMessage || ''}`);
  }

  // 6) 跨格式检索（每个查询分别命中一种格式，覆盖全部上传格式）
  const queries = [
    { q: '预算审批需要谁签字', expect: ['TXT'] },
    { q: '报销单需要谁审批', expect: ['MD'] },
    { q: '员工迟到几次记警告', expect: ['HTML'] },
    { q: '产品价格是多少', expect: ['XLSX'] },
    { q: 'travel reimbursement reviewed by whom', expect: ['PDF'] },
    { q: 'DOCX 中文 English mixed content', expect: ['DOCX'] },
  ];
  log('\n· 跨格式检索验证：');
  let allHit = true;
  const hitByFmt = {};
  for (const item of queries) {
    const ret = await fetch(`${BASE}/knowledge-bases/${kbId}/retrieve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: item.q, topK: 5 }),
    }).then((r) => r.json());
    const results = ret.data.results;
    log(`  query="${item.q}" → 命中 ${results.length} 条`);
    for (const r of results) {
      // 反查 chunk 来自哪个文档（通过 retrieve 返回的 documentId）
      const src = docs.find((d) => d.id === r.documentId);
      const fmt = src ? src.fmt : '?';
      hitByFmt[fmt] = (hitByFmt[fmt] || 0) + 1;
      log(
        `     [${fmt}] ${r.sources.join('+')} RRF=${r.score.toFixed(4)} ` +
          `vec=${r.vectorScore?.toFixed?.(3) ?? '-'} bm25=${r.bm25Score?.toFixed?.(3) ?? '-'}`,
      );
      log('        ', r.content.replace(/\s+/g, ' ').slice(0, 40));
    }
    const hitFmts = new Set(
      results.map((r) => docs.find((d) => d.id === r.documentId)?.fmt).filter(Boolean),
    );
    const okHit = item.expect.some((e) => hitFmts.has(e));
    if (!okHit) {
      allHit = false;
      log(`  ✗ 未命中预期格式 ${item.expect.join('/')}`);
    } else {
      ok(`query 命中预期格式 (${[...hitFmts].join(',')})`);
    }
  }

  // 7) 清理
  log('\n· 清理测试 KB...');
  await fetch(`${BASE}/knowledge-bases/${kbId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  rmSync(dir, { recursive: true, force: true });
  log('✓ 已删除 KB 与临时文件');

  // 8) 报告
  log('\n========== #61 E2E 验证报告 ==========');
  log('知识库创建        : ✓');
  const fmtOk = docs.filter((d) => d.status === 'completed').map((d) => d.fmt);
  log('上传格式 & 解析    : ' + docs.map((d) => `${d.fmt}=${d.status}`).join('  '));
  log('跨格式检索命中格式 : ' + Object.keys(hitByFmt).join(', '));
  const e2ePass = docs.every((d) => d.status === 'completed') && allHit;
  log('总体结论           : ' + (e2ePass ? '🎉 通过' : '⚠️ 部分未通过'));
  log('========================================');

  if (!e2ePass) process.exit(1);
}

main().catch((e) => {
  console.error('❌ 异常:', e);
  process.exit(1);
});
