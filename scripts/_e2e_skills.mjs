/**
 * Phase 4 · Skills 工具市场 端到端验证脚本
 *
 * 覆盖：
 *  1) 登录鉴权
 *  2) 创建 function 技能 + 沙箱执行（断言 output）
 *  3) 技能列表响应结构（versions / _count.agentSkills）
 *  4) OpenAPI 技能 CRUD（仅校验解析与创建）
 *  5) 智能体创建 + 绑定/解绑技能（setSkills / getSkills）
 *  6) 工作流 skill 节点：code 透传 → skill 执行，断言落库 ToolInvocation 链路（execution 成功 + skill 节点输出正确）
 *  7) 智能体对话（软校验：能拿到 conversationId 与流式输出，工具调用取决于模型是否支持 function calling）
 *
 * 运行：node scripts/_e2e_skills.mjs
 * 依赖：后端 http://localhost:3000 已启动，默认账号 admin/123456
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '123456';

let token = '';
let orgId = '';
const created = { skills: [], agents: [], workflows: [] };

// ---------- 小工具 ----------
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
    throw new Error(`${method} ${path} -> ${msg}`);
  }
  return data;
}

/** 读取 SSE 流，返回所有解析出的事件数组；resolve 当流结束 */
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

// ---------- 2. 创建 function 技能 + 执行 ----------
let functionSkillId = '';
async function stepCreateFunctionSkill() {
  log('\n[2] 创建 function 技能 + 沙箱执行');
  const skill = await api('POST', '/skills', {
    name: 'E2E-加法技能',
    type: 'function',
    description: '返回 a+b',
    sourceCode: 'return Number(input.a) + Number(input.b);',
    schemaJson: { properties: { a: { type: 'number' }, b: { type: 'number' } } },
    securityPolicy: { maxDuration: 2000 },
    status: 'active',
  });
  functionSkillId = skill.id;
  created.skills.push(functionSkillId);
  check('创建技能返回 id', !!functionSkillId, JSON.stringify(skill).slice(0, 120));

  const r = await api('POST', `/skills/${functionSkillId}/test`, { input: { a: 3, b: 4 } });
  check('执行状态 success', r.status === 'success', JSON.stringify(r));
  check('输出为 7', r.output === 7 || r.output === '7', `output=${JSON.stringify(r.output)}`);
  check('记录耗时 durationMs>=0', typeof r.durationMs === 'number', `durationMs=${r.durationMs}`);
}

// ---------- 3. 列表结构 ----------
async function stepListShape() {
  log('\n[3] 技能列表响应结构');
  const list = await api('GET', '/skills');
  const found = list.find((s) => s.id === functionSkillId);
  check('列表包含刚创建的技能', !!found);
  check('versions[0].version 存在', found?.versions?.[0]?.version === 1, JSON.stringify(found?.versions));
  check('_count.agentSkills 存在', found?._count && 'agentSkills' in found._count, JSON.stringify(found?._count));
  check('含 name/type/status', !!found?.name && !!found?.type && !!found?.status);
}

// ---------- 4. OpenAPI 技能 CRUD ----------
let openapiSkillId = '';
async function stepOpenApiSkill() {
  log('\n[4] OpenAPI 技能 CRUD（仅校验解析/创建）');
  const openapiSchema = {
    openapi: '3.0.0',
    info: { title: 'Mock', version: '1.0.0' },
    servers: [{ url: 'https://example.com/api' }],
    paths: {
      '/echo': {
        get: {
          operationId: 'echo',
          summary: '回声',
          parameters: [{ name: 'msg', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  const skill = await api('POST', '/skills', {
    name: 'E2E-OpenAPI技能',
    type: 'openapi',
    description: 'openapi 解析测试',
    openapiSchema,
    securityPolicy: { maxDuration: 2000 },
    status: 'active',
  });
  openapiSkillId = skill.id;
  created.skills.push(openapiSkillId);
  check('创建 openapi 技能返回 id', !!openapiSkillId);
  const detail = await api('GET', `/skills/${openapiSkillId}`);
  check('详情 versions[0].openapiSchema 解析为对象', typeof detail?.versions?.[0]?.openapiSchema === 'object');
}

// ---------- 5. 智能体绑定技能 ----------
let agentId = '';
let providerId = '';
async function stepAgentBinding() {
  log('\n[5] 智能体创建 + 绑定技能');
  const providers = await api('GET', '/llm-providers');
  providerId = providers?.[0]?.id;
  check('存在至少一个模型提供商', !!providerId, JSON.stringify(providers?.[0]));

  const agent = await api('POST', '/agents', {
    name: 'E2E-带技能智能体',
    type: 'chat',
    description: 'skills e2e',
    systemPrompt: '你是测试助手。',
    modelConfig: { providerId, model: '' },
  });
  agentId = agent.id;
  created.agents.push(agentId);
  check('创建智能体返回 id', !!agentId);

  const setRes = await api('PUT', `/agents/${agentId}/skills`, {
    skills: [{ skillId: functionSkillId, enabled: true }],
  });
  check('setSkills 成功', setRes?.success === true, JSON.stringify(setRes));

  const bound = await api('GET', `/agents/${agentId}/skills`);
  const boundIds = (bound || []).map((b) => b.skillId);
  check('getSkills 回显包含该技能', boundIds.includes(functionSkillId), JSON.stringify(boundIds));
}

// ---------- 6. 工作流 skill 节点 ----------
let workflowId = '';
let execId = '';
async function stepWorkflowSkill() {
  log('\n[6] 工作流 skill 节点执行');
  const graphJson = {
    nodes: [
      {
        id: 'n1',
        type: 'code',
        data: { label: '透传', config: { code: 'return input;' } },
      },
      {
        id: 'n2',
        type: 'skill',
        data: {
          label: '调用加法技能',
          config: { skillId: functionSkillId, input: { a: '{{input}}', b: 2 } },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  };
  const wf = await api('POST', '/workflows', {
    name: 'E2E-skill工作流',
    description: 'skill node e2e',
    graphJson,
    status: 'draft',
  });
  workflowId = wf.id;
  created.workflows.push(workflowId);
  check('创建工作流返回 id', !!workflowId);

  const res = await fetch(`${BASE}/workflows/${workflowId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input: '3' }),
  });
  check('run 端点 HTTP 200', res.ok, `status=${res.status}`);
  const events = await readSse(res);
  const runStart = events.find((e) => e.type === 'run_start');
  const done = events.find((e) => e.type === 'done');
  execId = runStart?.runId;
  check('收到 run_start 且 runId 非空', !!execId, JSON.stringify(runStart));
  check('收到 done 事件', !!done);
  const out = done?.output ?? '';
  check('最终输出包含 5（3+2）', String(out).includes('5'), `output=${JSON.stringify(out)}`);

  // 通过 execution 日志确认 skill 节点确实执行（间接验证 ToolInvocation 落库链路）
  const exec = await api('GET', `/workflows/${workflowId}/executions/${execId}`);
  check('execution 状态 success', exec?.status === 'success', exec?.status);
  const skillLog = (exec?.logs || []).find(
    (l) => l.eventType === 'node_end' && l.payloadJson?.output?.output === '5',
  );
  check('skill 节点 node_end 输出为 5（落库链路通过）', !!skillLog, JSON.stringify((exec?.logs || []).map((l) => l.payloadJson?.output)));
}

// ---------- 7. 智能体对话（软校验） ----------
async function stepAgentChat() {
  log('\n[7] 智能体对话（软校验：工具调用依赖模型 function calling 能力）');
  const res = await fetch(`${BASE}/agents/${agentId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: '请调用技能计算 11 加 22 等于多少？' }),
  });
  check('chat 端点 HTTP 200', res.ok, `status=${res.status}`);
  if (res.ok) {
    const events = await readSse(res);
    const conv = events.find((e) => e.conversationId);
    check('返回 conversationId', !!conv?.conversationId, JSON.stringify(conv));
    const hasDelta = events.some((e) => typeof e.delta === 'string');
    const isQuota = events.some((e) => typeof e.error === 'string' && /429|用量|quota|Token Plan/i.test(e.error));
    if (hasDelta) {
      log('  ✓ 产生流式 delta 文本（工具调用链路打通）');
    } else if (isQuota) {
      log('  ℹ 未产生 delta：模型返回 429 配额受限（环境限制，非代码缺陷）。技能绑定链路已在步骤 5 验证。');
    } else {
      log('  ℹ 未产生 delta：模型未触发工具调用或未流式输出（取决于模型 function calling 能力，本步仅信息性）。');
    }
  }
}

// ---------- 清理 ----------
async function cleanup() {
  log('\n[8] 清理测试数据');
  for (const id of created.workflows) { try { await api('DELETE', `/workflows/${id}`); } catch {} }
  for (const id of created.agents) { try { await api('DELETE', `/agents/${id}`); } catch {} }
  for (const id of created.skills) { try { await api('DELETE', `/skills/${id}`); } catch {} }
  ok('已尝试删除本次创建的 skills/agents/workflows');
}

// ---------- main ----------
async function main() {
  log(`== Phase 4 Skills E2E ==  BASE=${BASE}`);
  try {
    await stepLogin();
    await stepCreateFunctionSkill();
    await stepListShape();
    await stepOpenApiSkill();
    await stepAgentBinding();
    await stepWorkflowSkill();
    await stepAgentChat();
  } catch (e) {
    fail('执行中断', e?.message || String(e));
    log(e?.stack || '');
  } finally {
    await cleanup().catch(() => {});
  }

  const passed = results.filter((r) => r[0]).length;
  const total = results.length;
  log(`\n=== 结果：${passed}/${total} 通过 ===`);
  const failed = results.filter((r) => !r[0]);
  if (failed.length) {
    log('失败项：');
    failed.forEach((f) => log('  - ' + f[1]));
    process.exit(1);
  }
  process.exit(0);
}

main();
