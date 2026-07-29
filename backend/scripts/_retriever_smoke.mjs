/**
 * #59 retrievers 冒烟测试：创建 KB → 上传文档 → 等解析完成 → 检索命中。
 * 复用 curl 做 multipart 上传（最稳），其余用 fetch。
 */
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = 'http://localhost:3000/api';
const NODE = '/c/Users/liukun/.workbuddy/binaries/node/versions/22.22.2/node.exe';

async function main() {
  // 1) 登录
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  }).then((r) => r.json());
  const token = login.data.accessToken;
  const auth = { Authorization: `Bearer ${token}` };

  // 2) 创建 KB（embo-01 = MiniMax embedding）
  const kbRes = await fetch(`${BASE}/knowledge-bases`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'retriever-smoke-' + Date.now(),
      description: 'retrievers 冒烟测试',
      embeddingModel: 'embo-01',
    }),
  }).then((r) => r.json());
  const kbId = kbRes.data.id;
  console.log('✓ 创建 KB:', kbId);

  // 3) 准备一个样本文档
  const dir = mkdtempSync(path.join(tmpdir(), 'smoke-'));
  const file = path.join(dir, '预算制度.txt');
  writeFileSync(
    file,
    '公司年度预算审批流程如下：各部门在每年十一月提交下一年度预算草案，' +
      '由部门经理初审后送交财务部复核，财务总监终审签字后方可执行。' +
      '超过一百万元的资本支出还需董事会批准。预算执行过程接受内部审计监督。',
    'utf8',
  );

  // 4) 上传（curl multipart，最稳）
  const uploadOut = execSync(
    `curl -s -m 30 -X POST "${BASE}/knowledge-bases/${kbId}/documents" ` +
      `-H "Authorization: Bearer ${token}" ` +
      `-F "file=@${file};type=text/plain;filename=预算制度.txt"`,
    { encoding: 'utf8' },
  );
  const uploadJson = JSON.parse(uploadOut);
  const docId = uploadJson.data.id;
  console.log('✓ 上传文档:', docId, '状态=', uploadJson.data.parseStatus);

  // 5) 轮询状态到 completed（最多 ~60s）
  let status = 'pending';
  for (let i = 0; i < 30; i++) {
    const d = await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${docId}`, {
      headers: auth,
    }).then((r) => r.json());
    status = d.data.parseStatus;
    if (status === 'completed' || status === 'failed') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('✓ 解析状态:', status);
  if (status !== 'completed') {
    const d = await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${docId}`, {
      headers: auth,
    }).then((r) => r.json());
    console.error('  失败原因:', d.data.errorMessage);
    process.exit(1);
  }

  // 6) 检索
  const q = '预算审批需要谁签字';
  const ret = await fetch(`${BASE}/knowledge-bases/${kbId}/retrieve`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, topK: 3 }),
  }).then((r) => r.json());
  console.log('✓ 检索 query=%s → 命中 %d 条', q, ret.data.results.length);
  for (const r of ret.data.results) {
    console.log(
      `   [${r.sources.join('+')}] score=${r.score.toFixed(4)} vec=${r.vectorScore?.toFixed?.(4) ?? '-'} bm25=${r.bm25Score?.toFixed?.(4) ?? '-'}`,
    );
    console.log('      ', r.content.slice(0, 40).replace(/\n/g, ' '));
  }

  if (ret.data.results.length === 0) {
    console.error('❌ 检索未命中任何 chunk');
    process.exit(1);
  }
  console.log('\n🎉 #59 retrievers 冒烟通过');
}

main().catch((e) => {
  console.error('❌ 异常:', e);
  process.exit(1);
});
