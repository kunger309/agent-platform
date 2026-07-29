// E2E：方案 B 验证 - chat 接口注入 KB 检索 + sources 事件
import { writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const BASE = 'http://localhost:3000/api';

async function main() {
  // 1) 登录
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  }).then((r) => r.json());
  const token = login.data.accessToken;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  console.log('✓ 登录');

  // 2) 建 KB
  const kbName = 'chat-kb-test-' + Date.now();
  const kb = await fetch(`${BASE}/knowledge-bases`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: kbName, embeddingModel: 'embo-01' }),
  }).then((r) => r.json());
  const kbId = kb.data.id;
  console.log('✓ KB 创建 kbId=', kbId);

  // 3) 上传文档（multipart 真实模拟）
  const dir = mkdtempSync(path.join(tmpdir(), 'chatkb-'));
  const docPath = path.join(dir, 'policy.txt');
  writeFileSync(
    docPath,
    '公司年假制度：在公司工作满 1 年可享受 5 天带薪年假，满 5 年可享受 10 天，满 10 年可享受 15 天。' +
    '年假需提前 2 周申请，由部门经理审批，跨年度未休完视为放弃，不累计到下一年度。' +
    '员工离职时未休年假按日工资标准 300% 给予补偿。',
    'utf8',
  );
  const fileBuf = await import('node:fs').then((m) => m.readFileSync(docPath));
  const boundary = '----formboundary' + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="policy.txt"\r\nContent-Type: text/plain\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), fileBuf, Buffer.from(tail, 'utf8')]);
  const upRes = await fetch(`${BASE}/knowledge-bases/${kbId}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  }).then((r) => r.json());
  console.log('✓ 文档上传 docId=', upRes.data.id);

  // 4) 轮询解析完成
  for (let i = 0; i < 40; i++) {
    const d = await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${upRes.data.id}`, { headers: auth }).then((r) => r.json());
    if (d.data.parseStatus === 'completed' || d.data.parseStatus === 'failed') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('  解析:', (await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${upRes.data.id}`, { headers: auth }).then(r => r.json())).data.parseStatus);

  // 5) 调用 /api/chat 发送消息（带 kbIds）
  console.log('\n=== 方案 B：chat with KB injection ===');
  const chatRes = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: '在公司工作满 5 年能休几天年假？',
      kbIds: [kbId],
    }),
  });
  if (!chatRes.ok || !chatRes.body) { console.log('✗ chat 接口异常', chatRes.status); return; }

  const reader = chatRes.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let conversationId = null;
  let sources = null;
  let acc = '';
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const ev = JSON.parse(json);
        events.push(ev);
        if (ev.conversationId) conversationId = ev.conversationId;
        if (ev.sources) sources = ev.sources;
        if (ev.delta !== undefined) acc += ev.delta;
        if (ev.done || ev.error) break;
      } catch { /* 心跳 */ }
    }
    if (events.some((e) => e.done || e.error)) break;
  }

  console.log('  conversationId=', conversationId);
  console.log('  sources 数量=', sources?.length || 0);
  if (sources && sources.length) {
    console.log('\n=== Sources（前 3 条）===');
    for (const s of sources.slice(0, 3)) {
      console.log(`  - KB=${s.kbName} doc=${s.documentName} chunk=${s.chunkIndex} RRF=${s.score.toFixed(4)} vec=${s.vectorScore?.toFixed(4)} bm25=${s.bm25Score?.toFixed(4)}`);
      console.log(`    content: ${s.content.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  console.log('\n=== LLM 回答（前 400 字）===');
  console.log('  ', acc.replace(/\s+/g, ' ').slice(0, 400));

  // 6) 不带 kbIds 再发一次 → 验证 sources 应为空
  console.log('\n=== 对照：chat without KB（应无 sources 事件）===');
  const chatRes2 = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '年假几天？' }),
  });
  const reader2 = chatRes2.body.getReader();
  let buf2 = '';
  let sources2 = null;
  let acc2 = '';
  while (true) {
    const { value, done } = await reader2.read();
    if (done) break;
    buf2 += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf2.indexOf('\n\n')) !== -1) {
      const block = buf2.slice(0, idx); buf2 = buf2.slice(idx + 2);
      const line = block.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const ev = JSON.parse(json);
        if (ev.sources) sources2 = ev.sources;
        if (ev.delta !== undefined) acc2 += ev.delta;
        if (ev.done || ev.error) break;
      } catch { /* */ }
    }
    if (acc2.length > 0 && (events.some?.((e) => e.done) || true)) break;
  }
  console.log('  sources 数量=', sources2?.length || 0, '(期望 0)');
  console.log('  LLM 回答:', acc2.replace(/\s+/g, ' ').slice(0, 200));

  // 7) 清理
  await fetch(`${BASE}/knowledge-bases/${kbId}`, { method: 'DELETE', headers: auth });
  console.log('\n✓ KB 清理完成');
}

main().catch((e) => { console.error('✗ 测试失败:', e); process.exit(1); });