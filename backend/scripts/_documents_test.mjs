// documents 模块端到端测试
// 流程：login → 建 KB → 上传 TXT/MD/PDF → 轮询状态 → 校验 DB chunks + Qdrant points
//       → 删除文档（验证 Qdrant points 清零 + DB chunks 级联删）→ 清理 collection + KB
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import http from 'http';

const BASE = 'http://localhost:3000';
const QDRANT = (process.env.QDRANT_URL || 'http://localhost:6334').replace(/\/$/, '');
const SAMPLES = fileURLToPath(new URL('../test-samples/', import.meta.url));
const prisma = new PrismaClient();

function req(method, path, { body, token } = {}) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    let payload = null;
    if (body) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const r = http.request(BASE + path, { method, headers }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => resolve({ status: res.statusCode, body: s }));
    });
    r.on('error', reject);
    if (payload) {
      r.write(payload);
      r.end();
    } else {
      r.end();
    }
  });
}

// 用 Node 22 全局 fetch + FormData 上传文件
async function uploadFile(token, kbId, filePath, fileName, mime) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(filePath)], { type: mime }), fileName);
  const res = await fetch(`${BASE}/api/knowledge-bases/${kbId}/documents`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form,
  });
  const body = await res.text();
  return { status: res.status, body };
}

function assert(cond, msg) {
  if (!cond) {
    console.error('  ❌ FAIL:', msg);
    throw new Error('assertion failed: ' + msg);
  }
  console.log('  ✅', msg);
}

async function qdrantCount(kbId) {
  const res = await fetch(`${QDRANT}/collections/kb_${kbId}/points/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const j = await res.json();
  return j?.result?.count ?? -1;
}

let passed = 0;
let failed = 0;
async function step(name, fn) {
  process.stdout.write(`\n[${name}]\n`);
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error('  ⚠️  step error:', e.message);
  }
}

(async () => {
  // 1) login
  let token;
  await step('login', async () => {
    const r = await req('POST', '/api/auth/login', {
      body: { username: 'admin', password: '123456' },
    });
    const j = JSON.parse(r.body);
    assert(j.success, 'login success');
    token = j.data.accessToken;
  });

  // 2) 找 MiniMax provider（embo-01 用）
  let providerId;
  await step('list providers', async () => {
    const r = await req('GET', '/api/llm-providers', { token });
    const j = JSON.parse(r.body);
    assert(j.success, 'providers list ok');
    const mini = j.data.find((p) => p.providerType === 'MiniMax' && p.status === 'active');
    assert(mini, '找到 active MiniMax provider');
    providerId = mini.id;
  });

  // 3) 建 KB
  let kbId;
  await step('create KB', async () => {
    const r = await req('POST', '/api/knowledge-bases', {
      token,
      body: {
        name: 'E2E测试知识库_' + Date.now(),
        embeddingModel: 'embo-01',
        embeddingProviderId: providerId,
      },
    });
    const j = JSON.parse(r.body);
    assert(j.success, 'KB create ok');
    kbId = j.data.id;
    assert(!!kbId, 'kbId present');
  });

  // 4) 上传 3 种格式
  const uploads = [
    { file: SAMPLES + 'hello.txt', name: 'hello.txt', mime: 'text/plain' },
    { file: SAMPLES + 'readme.md', name: 'readme.md', mime: 'text/markdown' },
    { file: SAMPLES + 'sample.pdf', name: 'sample.pdf', mime: 'application/pdf' },
  ];
  const docIds = [];
  for (const u of uploads) {
    await step('upload ' + u.name, async () => {
      const r = await uploadFile(token, kbId, u.file, u.name, u.mime);
      const j = JSON.parse(r.body);
      assert(j.success, `upload ${u.name} ok (${r.status})`);
      docIds.push(j.data.id);
    });
  }

  // 5) 轮询状态直到全部 completed / failed
  await step('poll status', async () => {
    const deadline = Date.now() + 120_000;
    const final = {};
    while (Date.now() < deadline) {
      let allDone = true;
      for (const id of docIds) {
        if (final[id]) continue;
        const r = await req('GET', `/api/knowledge-bases/${kbId}/documents/${id}`, { token });
        const j = JSON.parse(r.body);
        const st = j.data?.parseStatus;
        if (st === 'completed' || st === 'failed') {
          final[id] = j.data;
        } else {
          allDone = false;
        }
      }
      if (allDone) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log('  final statuses:', docIds.map((id) => `${id.slice(0, 8)}:${final[id]?.parseStatus}`).join(', '));
    for (const id of docIds) {
      const d = final[id];
      assert(d, `doc ${id.slice(0, 8)} 处理结束（非 pending/processing）`);
      assert(d.parseStatus === 'completed', `doc ${id.slice(0, 8)} 状态=completed（实际 ${d.parseStatus}${d.errorMessage ? ' err=' + d.errorMessage : ''}）`);
      assert(d.chunkCount > 0, `doc ${id.slice(0, 8)} chunkCount=${d.chunkCount} > 0`);
    }
  });

  // 6) 校验 DB chunks + Qdrant points
  await step('verify DB chunks + Qdrant', async () => {
    for (const id of docIds) {
      const cnt = await prisma.documentChunk.count({ where: { documentId: id } });
      assert(cnt > 0, `DB document_chunks for ${id.slice(0, 8)} = ${cnt}`);
    }
    const qc = await qdrantCount(kbId);
    assert(qc > 0, `Qdrant points in kb_${kbId} = ${qc}`);
    console.log(`  Qdrant 总点数=${qc}`);
  });

  // 7) 删除第 1 个文档 → 验证 Qdrant points 减少 + DB chunks 级联删
  await step('delete document', async () => {
    const delId = docIds[0];
    const beforeQ = await qdrantCount(kbId);
    const beforeChunks = await prisma.documentChunk.count({ where: { documentId: delId } });
    const r = await req('DELETE', `/api/knowledge-bases/${kbId}/documents/${delId}`, { token });
    const j = JSON.parse(r.body);
    assert(j.success, 'delete doc ok');

    const afterQ = await qdrantCount(kbId);
    const afterChunks = await prisma.documentChunk.count({ where: { documentId: delId } });
    assert(afterChunks === 0, `DB chunks 级联删除（${beforeChunks} → ${afterChunks}）`);
    assert(afterQ < beforeQ, `Qdrant points 减少（${beforeQ} → ${afterQ}）`);
    docIds.shift(); // 移除已删
  });

  // 8) 清理：删 KB + Qdrant collection
  await step('cleanup', async () => {
    await req('DELETE', `/api/knowledge-bases/${kbId}`, { token });
    await fetch(`${QDRANT}/collections/kb_${kbId}`, { method: 'DELETE' }).catch(() => {});
    console.log('  cleanup done');
  });

  await prisma.$disconnect();
  console.log(`\n==== 结果: passed=${passed} failed=${failed} ====`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
