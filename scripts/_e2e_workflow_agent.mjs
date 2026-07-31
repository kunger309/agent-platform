/**
 * 流程编排类型智能体（agent.type=workflow）端到端验证
 *
 * 覆盖：
 *  1) 登录鉴权
 *  2) 创建一个只含 Answer 节点（回显输入）的工作流
 *  3) 创建 workflow 类型智能体并绑定该工作流
 *  4) 负向：type=workflow 但缺 workflowId → 期望 400
 *  5) 对 workflow 智能体发起对话（SSE），断言收到 delta + done，且 accumulator 包含输入
 *  6) 清理（删除智能体、工作流）
 *
 * 运行：node scripts/_e2e_workflow_agent.mjs
 * 依赖：后端 http://localhost:3000 已启动，默认账号 admin/123456
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '123456';

let token = '';
let orgId = '';
const created = { agents: [], workflows: [] };

function log(...a) { console.log(...a); }
function ok(name) { log(`  \x1b[32m✓\x1b[0m ${name}`); }
function fail(name, detail) { log(`  \x1b[31m✗\x1b[0m ${name} :: ${detail}`); }
const results = [];
function check(name, cond, detail = '') {
  if (cond) { ok(name); results.push([true, name]); }
  else { fail(name, detail); results.push([false, name + ' :: ' + detail]); }
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  const data = json?.success === true ? json.data : json;
  if (!res.ok) {
    const msg = (json?.message) || (json?.error) || (`HTTP ${res.status}`);
    const err = new Error(`${method} ${path} -> ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** 读取 SSE 流，返回所有解析出的事件数组 */
async function readSse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const m = chunk.match(/^data:\s*(.*)$/ms);
      if (m) {
        try { events.push(JSON.parse(m[1])); } catch { /* ignore */ }
      }
    }
  }
  return events;
}

// ---------- 1. 登录 ----------
async function stepLogin() {
  log('\n[1] 登录鉴权');
  const data = await api('POST', '/auth/login', { username: USER, password: PASS });
  token = data.accessToken;
  orgId = data.user.currentOrgId;
  check('拿到 accessToken', !!token);
  check('拿到 currentOrgId', !!orgId, orgId);
}

// ---------- 2. 创建工作流（Answer 节点回显输入）----------
let workflowId = '';
async function stepCreateWorkflow() {
  log('\n[2] 创建工作流（answer 节点回显）');
  const graphJson = {
    nodes: [
      {
        id: 'a1',
        type: 'answer',
        data: { label: '回显', config: { template: '你的问题是：{{input}}' } },
      },
    ],
    edges: [],
  };
  const draft = await api('POST', '/workflows', {
    name: 'E2E-WorkflowAgent工作流',
    description: 'workflow agent e2e',
    graphJson,
  });
  workflowId = draft.id;
  created.workflows.push(workflowId);
  check('创建工作流返回 id', !!workflowId, JSON.stringify(draft).slice(0, 120));
  // 创建工作流默认 draft，必须发布后才能在智能体下拉出现
  const wf = await api('POST', `/workflows/${workflowId}/publish`, {});
  check('发布后 status=published', wf.status === 'published', `status=${wf.status}`);
  // 发布后应出现在 published 下拉
  const published = await api('GET', '/workflows/published');
  const inPublished = Array.isArray(published) && published.some((w) => w.id === workflowId);
  check('发布后出现在 /api/workflows/published', inPublished);
}

// ---------- 3. 创建 workflow 类型智能体 ----------
let agentId = '';
async function stepCreateWorkflowAgent() {
  log('\n[3] 创建 workflow 类型智能体');
  const agent = await api('POST', '/agents', {
    name: 'E2E-流程编排智能体',
    type: 'workflow',
    description: '绑定上面创建的工作流',
    workflowId,
  });
  agentId = agent.id;
  created.agents.push(agentId);
  check('创建智能体返回 id', !!agentId);
  check('type 落库为 workflow', agent.type === 'workflow', `type=${agent.type}`);
  check('workflowId 落库', agent.workflowId === workflowId, `wf=${agent.workflowId}`);
}

// ---------- 4. 负向：缺 workflowId ----------
async function stepNegativeNoWorkflow() {
  log('\n[4] 负向：type=workflow 缺 workflowId → 期望 400');
  try {
    await api('POST', '/agents', {
      name: 'E2E-缺工作流',
      type: 'workflow',
      description: 'should fail',
    });
    check('缺 workflowId 被正确拒绝（抛错）', false, '服务端未拒绝');
  } catch (e) {
    check('缺 workflowId 被正确拒绝', e.status === 400, `status=${e.status}, msg=${e.message}`);
  }
}

// ---------- 4b. 草稿过滤 + 强制 published 校验 ----------
let draftWfId = '';
async function stepDraftFilter() {
  log('\n[4b] 草稿过滤：草稿不应出现在 published 下拉；用草稿建 agent 应被 400 拒绝；发布后出现');

  // 1) 创建一个草稿工作流
  const draftWf = await api('POST', '/workflows', {
    name: 'E2E-草稿工作流',
    description: '草稿',
    graphJson: { nodes: [{ id: 'a1', type: 'answer', data: { label: '回显', config: { template: '{{input}}' } } }], edges: [] },
    status: 'draft',
  });
  draftWfId = draftWf.id;
  created.workflows.push(draftWfId);
  check('草稿工作流创建成功', !!draftWfId);

  // 2) published 列表不应包含草稿
  const published = await api('GET', '/workflows/published');
  const inPublished = Array.isArray(published) && published.some((w) => w.id === draftWfId);
  check('草稿不出现在 /api/workflows/published', !inPublished, `published=${JSON.stringify(published.map((w) => w.name))}`);

  // 3) 全量列表应包含草稿（确认确实是 draft 状态）
  const all = await api('GET', '/workflows');
  const inAll = Array.isArray(all) && all.some((w) => w.id === draftWfId);
  check('草稿出现在 /api/workflows 全量列表', inAll);

  // 4) 用草稿 workflowId 建 agent 应被 400 拒绝
  try {
    await api('POST', '/agents', {
      name: 'E2E-绑草稿',
      type: 'workflow',
      workflowId: draftWfId,
    });
    check('绑定草稿工作流被正确拒绝（抛错）', false, '服务端未拒绝');
  } catch (e) {
    check('绑定草稿工作流被 400 拒绝', e.status === 400, `status=${e.status}, msg=${e.message}`);
  }

  // 5) 发布草稿后，应出现在 published 列表
  await api('POST', `/workflows/${draftWfId}/publish`, {});
  const published2 = await api('GET', '/workflows/published');
  const inPublished2 = Array.isArray(published2) && published2.some((w) => w.id === draftWfId);
  check('发布后出现在 /api/workflows/published', inPublished2);
}

// ---------- 5. 对话（SSE）----------
async function stepChatAsWorkflow() {
  log('\n[5] 对 workflow 智能体发起对话（SSE）');
  const res = await fetch(`${BASE}/agents/${agentId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message: '今天天气如何' }),
  });
  check('chat 端点 HTTP 200', res.ok, `status=${res.status}`);
  const events = await readSse(res);
  const convEvent = events.find((e) => e.conversationId);
  const deltaText = events
    .filter((e) => typeof e.delta === 'string')
    .map((e) => e.delta)
    .join('');
  const doneEvent = events.find((e) => e.done === true);
  check('收到 conversationId 事件', !!convEvent, JSON.stringify(events[0] || {}));
  check('收到至少一个 delta', deltaText.length > 0, `deltaText=${deltaText.slice(0, 60)}`);
  check('delta 包含输入回显', deltaText.includes('今天天气如何'), `deltaText=${deltaText.slice(0, 60)}`);
  check('收到 done 事件', !!doneEvent);
}

// ---------- 6. 清理 ----------
async function stepCleanup() {
  log('\n[6] 清理');
  for (const id of created.agents) {
    try { await api('DELETE', `/agents/${id}`); } catch { /* ignore */ }
  }
  for (const id of created.workflows) {
    try { await api('DELETE', `/workflows/${id}`); } catch { /* ignore */ }
  }
  check('清理完成', true);
}

// ---------- 运行 ----------
async function main() {
  log('=== 流程编排智能体 E2E ===');
  try {
    await stepLogin();
    await stepCreateWorkflow();
    await stepCreateWorkflowAgent();
    await stepNegativeNoWorkflow();
    await stepDraftFilter();
    await stepChatAsWorkflow();
  } catch (e) {
    fail('运行异常', e?.message || String(e));
  } finally {
    await stepCleanup();
  }
  const passed = results.filter((r) => r[0]).length;
  const total = results.length;
  log(`\n=== 结果：${passed}/${total} 通过 ===`);
  if (passed !== total) {
    log('失败项：');
    results.filter((r) => !r[0]).forEach((r) => log('  - ' + r[1]));
    process.exit(1);
  }
  process.exit(0);
}
main();
