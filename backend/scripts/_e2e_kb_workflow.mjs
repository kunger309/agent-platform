// E2E: KB 节点 + LLM 节点 + Answer 节点的 RAG 工作流
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
  const kbName = 'kb-wf-test-' + Date.now();
  const kbRaw = await fetch(`${BASE}/knowledge-bases`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: kbName, embeddingModel: 'embo-01', chunkSize: 200, chunkOverlap: 30 }),
  });
  const kb = await kbRaw.json();
  if (!kb.data) { console.log('✗ KB 创建失败 raw=', JSON.stringify(kb), 'status=', kbRaw.status); return; }
  const kbId = kb.data.id;
  console.log('✓ KB 创建 kbId=', kbId);

  // 3) 上传文档
  const dir = mkdtempSync(path.join(tmpdir(), 'kbwf-'));
  const docPath = path.join(dir, 'company-policy.txt');
  writeFileSync(
    docPath,
    '公司差旅报销制度：员工出差需提前 3 天申请，经直属经理审批。住宿标准一线城市每晚不超过 800 元，二线城市不超过 600 元。' +
    '餐补标准每日 100 元，需在出差结束后 10 个工作日内提交报销单，附发票原件。' +
    '财务部门审核周期为 5 个工作日，审核通过后 3 个工作日内打款。',
    'utf8',
  );
  // 模拟浏览器 multipart（Buffer + filename + type）
  const fileBuf = await import('node:fs').then((m) => m.readFileSync(docPath));
  const boundary = '----formboundary' + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="company-policy.txt"\r\nContent-Type: text/plain\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head, 'utf8'), fileBuf, Buffer.from(tail, 'utf8')]);
  const upRes = await fetch(`${BASE}/knowledge-bases/${kbId}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  }).then((r) => r.json());
  const docId = upRes.data.id;
  console.log('✓ 文档上传 docId=', docId);

  // 4) 轮询解析完成
  for (let i = 0; i < 40; i++) {
    const d = await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${docId}`, { headers: auth }).then((r) => r.json());
    if (d.data.parseStatus === 'completed' || d.data.parseStatus === 'failed') break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const detail = await fetch(`${BASE}/knowledge-bases/${kbId}/documents/${docId}`, { headers: auth }).then((r) => r.json());
  console.log('  解析:', detail.data.parseStatus, 'chunks=', detail.data.chunkCount);
  if (detail.data.parseStatus !== 'completed') throw new Error('解析失败');

  // 5) 创建工作流：kb → llm → answer
  // - kb 节点：检索「{{input}}」
  // - llm 节点：promptTemplate 引用 kb.output + input
  // - answer 节点：template 引用 llm.output
  const wfRes = await fetch(`${BASE}/workflows`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      name: 'kb-rag-' + Date.now(),
      description: 'KB+RAG demo',
      graphJson: {
        nodes: [
          { id: 'n1_kb', type: 'kb', data: { config: { kbId, query: '{{input}}', topK: 3, scoreThreshold: 0 } } },
          { id: 'n2_llm', type: 'llm', data: { config: { promptTemplate: '请基于以下资料回答用户问题。\n\n资料：\n{{n1_kb.output}}\n\n用户问题：{{input}}\n\n回答：', systemPrompt: '你是一个严谨的公司制度问答助手。', providerId: '', model: '' } } },
          { id: 'n3_ans', type: 'answer', data: { config: { template: '{{n2_llm.output}}' } } },
        ],
        edges: [
          { source: 'n1_kb', target: 'n2_llm' },
          { source: 'n2_llm', target: 'n3_ans' },
        ],
      },
    }),
  }).then((r) => r.json());
  const wfId = wfRes.data.id;
  console.log('✓ 工作流创建 wfId=', wfId);

  // 6) 发布
  await fetch(`${BASE}/workflows/${wfId}/publish`, { method: 'POST', headers: auth }).then((r) => r.json());
  console.log('✓ 工作流发布');

// 7) 运行（SSE 流式响应；从 run_start 事件拿 runId = executionId）
  const sseRes = await fetch(`${BASE}/workflows/${wfId}/runs`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ input: '差旅报销的住宿标准是多少？' }),
  });
  if (!sseRes.ok || !sseRes.body) { console.log('✗ runs 接口响应异常', sseRes.status); return; }

  let executionId = null;
  const events = [];
  const reader = sseRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
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
      if (!json || json.startsWith(':')) continue;
      try {
        const ev = JSON.parse(json);
        events.push(ev);
        if (ev.type === 'run_start') executionId = ev.runId;
        if (ev.type === 'done' || ev.type === 'error') break;
      } catch { /* 忽略心跳 */ }
    }
    if (events.some((e) => e.type === 'done' || e.type === 'error')) break;
  }
  if (!executionId) { console.log('✗ 没拿到 executionId'); console.log(events.slice(-3)); return; }
  console.log('✓ SSE 拿到 executionId=', executionId, '  收到事件数=', events.length);

  // 8) 拉完整 ExecutionLog（含 kb 节点 output payload）
  const ex = await fetch(`${BASE}/workflows/${wfId}/executions/${executionId}`, { headers: auth }).then((r) => r.json());
  console.log('  Execution 状态:', ex.data.status, 'error:', ex.data.errorMessage);

  const logs = ex.data.logs || [];
  const kbLog = logs.find((l) => l.nodeKey === 'n1_kb' && l.eventType === 'node_end');
  const llmLog = logs.find((l) => l.nodeKey === 'n2_llm' && l.eventType === 'node_end');
  const ansLog = logs.find((l) => l.nodeKey === 'n3_ans' && l.eventType === 'node_end');

  if (!kbLog) { console.log('✗ 没找到 KB 节点日志'); return; }
  console.log('\n=== KB 节点 output (结构化) ===');
  console.log('  total=', kbLog.payloadJson.output?.total, 'hits=', kbLog.payloadJson.output?.hits?.length);
  for (const h of (kbLog.payloadJson.output?.hits || []).slice(0, 3)) {
    console.log('    -', h.content.replace(/\s+/g, ' ').slice(0, 60), '| score=', h.score.toFixed(4), '| sources=', h.sources.join('+'));
  }

  if (llmLog) {
    console.log('\n=== LLM 节点 output ===');
    console.log('  ', (llmLog.payloadJson.output?.content || '').replace(/\s+/g, ' ').slice(0, 200));
  }
  if (ansLog) {
    console.log('\n=== Answer 节点 output ===');
    console.log('  ', String(ansLog.payloadJson.output || '').replace(/\s+/g, ' ').slice(0, 200));
  }

  // 9) 清理 KB
  await fetch(`${BASE}/knowledge-bases/${kbId}`, { method: 'DELETE', headers: auth });
  console.log('\n✓ KB 清理完成');
}

main().catch((e) => { console.error('✗ 测试失败:', e); process.exit(1); });