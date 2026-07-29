// 真实浏览器 multipart 场景：filename 是 UTF-8 字节 → 服务端按 latin1 误读 → latin1→UTF-8 还原
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = 'http://localhost:3000/api';
const dir = mkdtempSync(path.join(tmpdir(), 'fix-'));
const file = path.join(dir, '个人知识库测试.txt');
const chineseName = '个人知识库测试.txt';
writeFileSync(
  file,
  '本文件用于验证中文文件名编码与切片详情接口。\n第二段内容：测试关键词「人工智能」与「知识库检索」。',
  'utf8',
);

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '123456' }),
}).then((r) => r.json());
const token = login.data.accessToken;

const kb = await fetch(`${BASE}/knowledge-bases`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'fix-test-' + Date.now(), embeddingModel: 'embo-01' }),
}).then((r) => r.json());
const kbId = kb.data.id;

// 用 Node fetch + FormData 模拟浏览器（UTF-8 字节）
const buf = await import('node:fs').then((m) => m.readFileSync(file));
const formData = new FormData();
formData.append('file', new Blob([buf], { type: 'text/plain' }), chineseName);

const upRes = await fetch(`${BASE}/knowledge-bases/${kbId}/documents`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: formData,
}).then((r) => r.json());
const upload = upRes.data;
console.log('✓ 上传 doc=', upload.id);
console.log('  name(列表) =', upload.name);
console.log('  name 字节序列 =', JSON.stringify(upload.name));
console.log('  中文是否完整:', upload.name === chineseName ? '✓ 修复生效' : '✗ 仍乱码');

let d = upload;
for (let i = 0; i < 30; i++) {
  const r = await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${d.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  d = r.data;
  if (d.parseStatus === 'completed' || d.parseStatus === 'failed') break;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log('  解析:', d.parseStatus, '切片数=', d.chunkCount);

const chunks = await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${d.id}/chunks`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
console.log('✓ /chunks 返回', chunks.data.length, '条');
for (const c of chunks.data) {
  console.log(`  [chunk ${c.chunkIndex}] page=${c.pageNumber} tokens=${c.tokenCount}`);
  console.log('     content:', c.content.slice(0, 50));
}

await fetch(`${BASE}/knowledge-bases/${kbId}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${token}` },
});
console.log('✓ 清理完成');
