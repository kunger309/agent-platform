// 端到端验证：确定性 DAG（Code 分类 → Condition 分支 → Answer/HTTP）+ 状态落库
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  });
  return (await r.json()).data.accessToken;
}
async function createWf(token, graphJson) {
  const r = await fetch(`${BASE}/api/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'e2e-dag', status: 'draft', graphJson }),
  });
  return (await r.json()).data.id;
}
async function runWf(token, id, input) {
  const r = await fetch(`${BASE}/api/workflows/${id}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input }),
  });
  const text = await r.text();
  return text
    .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6).trim()));
}

const graphJson = {
  nodes: [
    { id: 'n1', type: 'code', data: { config: { code: "return /[一-龥]/.test(input) ? 'cn' : 'en';" } } },
    { id: 'n2', type: 'condition', data: { config: { variable: 'variables.n1.output', operator: 'equals', value: 'cn' } } },
    { id: 'n3', type: 'answer', data: { config: { template: '中文分支命中：{{n1.output}}' } } },
    { id: 'n4', type: 'http', data: { config: { method: 'POST', url: 'https://httpbin.org/post', bodyTemplate: '{"echo":"{{input}}"}', headers: '{"Content-Type":"application/json"}' } } },
  ],
  edges: [
    { source: 'n1', target: 'n2' },
    { source: 'n2', target: 'n3', sourceHandle: 'true' },
    { source: 'n2', target: 'n4', sourceHandle: 'false' },
  ],
};

const token = await login();
const wid = await createWf(token, graphJson);
console.log('WID:', wid);

// 中文 → n3 (answer)
const e1 = await runWf(token, wid, '你好世界');
const done1 = e1.find((e) => e.type === 'done');
console.log('RUN1(中文) 序列:', e1.map((e) => e.type + (e.nodeId ? ':' + e.nodeId : '')).join(' '));
console.log('RUN1 done.output:', JSON.stringify(done1.output), '| 节点:', Object.keys(done1.variables).filter((k) => k.endsWith('.output')));

// 英文 → n4 (http)
const e2 = await runWf(token, wid, 'hello world');
const done2 = e2.find((e) => e.type === 'done');
console.log('RUN2(英文) 序列:', e2.map((e) => e.type + (e.nodeId ? ':' + e.nodeId : '')).join(' '));
console.log('RUN2 done.output(前80):', JSON.stringify(String(done2.output).slice(0, 80)), '| 节点:', Object.keys(done2.variables).filter((k) => k.endsWith('.output')));

await sleep(800);
const execResp = await fetch(`${BASE}/api/workflows/${wid}/executions`, { headers: { Authorization: `Bearer ${token}` } });
const execs = (await execResp.json()).data;
console.log('=== Execution 状态 ===');
execs.forEach((ex) => console.log(`  ${ex.id} | status=${ex.status} | input=${JSON.stringify(ex.inputJson)}`));

// 另测：LLM → Answer 的 {{n1.output}} 插值（Bug1 修复验证）
const llmGraph = {
  nodes: [
    { id: 'a1', type: 'llm', data: { config: { promptTemplate: '把这句翻译成中文：{{input}}' } } },
    { id: 'a2', type: 'answer', data: { config: { template: '翻译结果：{{a1.output}}' } } },
  ],
  edges: [{ source: 'a1', target: 'a2' }],
};
const wid2 = await createWf(token, llmGraph);
const e3 = await runWf(token, wid2, 'hello');
const done3 = e3.find((e) => e.type === 'done');
console.log('LLM→Answer done.output:', JSON.stringify(done3.output));
