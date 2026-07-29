// 验证 documents.service.remove() 的 4 条清理路径
// 1) Document 主表记录 → 期望 404
// 2) DocumentChunk 行（走后端 /chunks 接口） → 期望 0 条
// 3) 磁盘文件 <UPLOAD_ROOT>/<docId>__<safeName> → 期望不存在
// 4) Qdrant collection 中 documentId==X 的 points 数 → 期望 0
import { writeFileSync, existsSync, mkdtempSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const API = 'http://localhost:3000/api';
const QDRANT = 'http://localhost:6334';
// 与 backend/src/documents/documents.service.ts 的 UPLOAD_ROOT 一致：
// process.cwd() = backend 启动目录；后端从 backend/ 启动，故 cwd = backend
const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads', 'documents');

function ok(label) { console.log(`✓ ${label}`); }
function bad(label, detail) { console.log(`✗ ${label}${detail ? ': ' + detail : ''}`); }

async function qdrantPoints(kbId) {
  const r = await fetch(`${QDRANT}/collections/kb_${kbId}`);
  if (!r.ok) throw new Error(`Qdrant GET collection failed: ${r.status}`);
  const j = await r.json();
  return j.result?.points_count ?? null;
}
async function qdrantDocCount(kbId, docId) {
  const r = await fetch(`${QDRANT}/collections/kb_${kbId}/points/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { must: [{ key: 'documentId', match: { value: docId } }] },
      exact: true,
    }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return j.result?.count ?? null;
}

// 0) 登录
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '123456' }),
}).then((r) => r.json());
if (!login.data?.accessToken) { console.error('登录失败', login); process.exit(1); }
const token = login.data.accessToken;
const auth = { Authorization: `Bearer ${token}` };

// 1) 建 KB
const ts = Date.now();
const kb = await fetch(`${API}/knowledge-bases`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `del-verify-${ts}`, embeddingModel: 'embo-01' }),
}).then((r) => r.json());
const kbId = kb.data.id;
console.log(`\n· 建 KB ${kbId}`);

// 2) 用 Node FormData 模拟真实浏览器（绕过 Git Bash 二次编码）
const fd = new FormData();
const dir = mkdtempSync(path.join(tmpdir(), 'del-'));
const file = path.join(dir, '个人知识库测试.txt');
writeFileSync(
  file,
  '本文用于验证文档删除后四路清理。\n第一段：人工智能与知识库检索。\n第二段：测试关键词 "人工智能"。',
  'utf8',
);
fd.append('file', new Blob([await import('node:fs').then((m) => m.readFileSync(file))], { type: 'text/plain' }), '个人知识库测试.txt');
const up = await fetch(`${API}/knowledge-bases/${kbId}/documents`, { method: 'POST', headers: auth, body: fd }).then((r) => r.json());
if (!up.data?.id) { console.error('上传失败', up); process.exit(1); }
const docId = up.data.id;
const safeName = up.data.name;
console.log(`· 上传 doc=${docId} name="${safeName}"`);

// 3) 轮询到 completed
let d = up.data;
for (let i = 0; i < 30; i++) {
  const r = await fetch(`${API}/knowledge-bases/${kbId}/documents/${docId}`, { headers: auth }).then((r) => r.json());
  d = r.data;
  if (d.parseStatus === 'completed' || d.parseStatus === 'failed') break;
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`· 解析 ${d.parseStatus}, chunks=${d.chunkCount}`);
if (d.parseStatus !== 'completed') { console.error('解析失败，终止'); process.exit(1); }

// 4) 删除前快照
const before = {
  docExists: true,
  chunks: d.chunkCount,
  qdrantAll: await qdrantPoints(kbId),
  qdrantThisDoc: await qdrantDocCount(kbId, docId),
  fsPath: path.join(UPLOAD_ROOT, `${docId}__${safeName}`),
  fsExists: existsSync(path.join(UPLOAD_ROOT, `${docId}__${safeName}`)),
};
console.log('\n· 删除前状态:', before);

// 5) 触发删除（走前端同一个接口）
const del = await fetch(`${API}/knowledge-bases/${kbId}/documents/${docId}`, { method: 'DELETE', headers: auth });
console.log(`\n· DELETE 返回 ${del.status}`);
if (!del.ok) {
  const t = await del.text();
  console.error('删除失败:', t);
  process.exit(1);
}

// 6) 删除后核对
const afterDoc = await fetch(`${API}/knowledge-bases/${kbId}/documents/${docId}`, { headers: auth });
const afterChunks = await fetch(`${API}/knowledge-bases/${kbId}/documents/${docId}/chunks`, { headers: auth }).then((r) => r.json());
const after = {
  docApiStatus: afterDoc.status,
  chunksApiCount: afterChunks.data?.length ?? 'n/a',
  qdrantAll: await qdrantPoints(kbId),
  qdrantThisDoc: await qdrantDocCount(kbId, docId),
  fsExists: existsSync(path.join(UPLOAD_ROOT, `${docId}__${safeName}`)),
};
console.log('· 删除后状态:', after);

// 7) 评估
console.log('\n· 评估清理路径：');

// 诊断：后端 unlink 被 catch 吞了，我直接试一次
try {
  unlinkSync(before.fsPath);
  ok('诊断 — 我能直接 unlink 该文件（→ 后端 unlink 被吞错，是 bug）');
} catch (e) {
  bad('诊断 — 文件被外进程锁住', `${e.code} ${e.message}`);
}
afterDoc.status === 404 ? ok('1) Document 主表记录 — 已删 (GET 404)') : bad('1) Document 主表记录', `GET ${afterDoc.status}`);
afterChunks.data?.length === 0 ? ok('2) DocumentChunk 行 — 已 cascade (chunks=0)') : bad('2) DocumentChunk 行', `chunks=${afterChunks.data?.length}`);
!after.fsExists ? ok(`3) 磁盘文件 — 已 unlink (${before.fsPath})`) : bad('3) 磁盘文件', '仍存在');
after.qdrantThisDoc === 0 ? ok('4) Qdrant 该文档向量点 — 已删 (count=0)') : bad('4) Qdrant 向量点', `count=${after.qdrantThisDoc}`);
console.log(`   补充：collection 总 points ${before.qdrantAll} → ${after.qdrantAll}`);

// 8) 清理 KB
await fetch(`${API}/knowledge-bases/${kbId}`, { method: 'DELETE', headers: auth });
console.log(`\n✓ 测试 KB 已清理 (${kbId})`);