/**
 * 工作台（dashboard）端到端验证
 *
 * 覆盖：
 *  1) 登录鉴权
 *  2) GET /api/dashboard/stats 返回结构 + 字段非空
 *  3) 初始 stats 数字 >= 0
 *  4) 创建 1 个 skill → stats.skills 增加 1
 *  5) 创建 1 个草稿工作流 → stats.workflows 增加 1
 *
 * 运行：node scripts/_e2e_dashboard.mjs
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '123456';

let token = '';
const created = { skills: [], workflows: [] };

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

async function stepLogin() {
  log('\n[1] 登录鉴权');
  const data = await api('POST', '/auth/login', { username: USER, password: PASS });
  token = data.accessToken;
  check('拿到 accessToken', !!token);
}

async function stepStatsShape() {
  log('\n[2] GET /api/dashboard/stats 结构 + 字段');
  const stats = await api('GET', '/dashboard/stats');
  const required = ['agents', 'workflows', 'knowledgeBases', 'skills', 'conversations', 'orgId', 'orgName'];
  const missing = required.filter((k) => !(k in stats));
  check('返回字段齐全', missing.length === 0, `缺失: ${missing.join(',')}`);
  check('orgId 非空', !!stats.orgId, JSON.stringify(stats));
  check('orgName 非空', !!stats.orgName, JSON.stringify(stats));
  for (const k of ['agents', 'workflows', 'knowledgeBases', 'skills', 'conversations']) {
    check(`${k} >= 0 且为整数`, Number.isInteger(stats[k]) && stats[k] >= 0, `value=${stats[k]}`);
  }
  return stats;
}

async function stepIncrement(initial) {
  log('\n[3] 创建 1 个 skill + 1 个草稿工作流 → stats 应增加');

  // 建 skill
  const sk = await api('POST', '/skills', {
    name: 'E2E-Dashboard计数用skill',
    description: '用于验证 stats.skills +1',
    type: 'function',
    sourceCode: 'module.exports = async (input) => ({ ok: true, sum: 1 + 1 });',
    schemaJson: { type: 'object', properties: {} },
  });
  created.skills.push(sk.id);
  check('skill 创建成功', !!sk.id);

  // 建草稿工作流（status 不传，默认 draft）
  const wf = await api('POST', '/workflows', {
    name: 'E2E-Dashboard计数用工作流',
    description: '用于验证 stats.workflows +1',
    graphJson: { nodes: [{ id: 'a1', type: 'answer', data: { label: '回显', config: { template: '{{input}}' } } }], edges: [] },
  });
  created.workflows.push(wf.id);
  check('工作流创建成功', !!wf.id);

  // 再拉 stats 断言 +1
  const next = await api('GET', '/dashboard/stats');
  check('stats.skills 增加 1', next.skills === initial.skills + 1, `was=${initial.skills}, now=${next.skills}`);
  check('stats.workflows 增加 1', next.workflows === initial.workflows + 1, `was=${initial.workflows}, now=${next.workflows}`);
}

async function stepCleanup() {
  log('\n[4] 清理');
  for (const id of created.skills) {
    try { await api('DELETE', `/skills/${id}`); } catch { /* ignore */ }
  }
  for (const id of created.workflows) {
    try { await api('DELETE', `/workflows/${id}`); } catch { /* ignore */ }
  }
  check('清理完成', true);
}

async function main() {
  log('=== 工作台统计 E2E ===');
  try {
    await stepLogin();
    const initial = await stepStatsShape();
    await stepIncrement(initial);
  } catch (e) {
    fail('运行异常', e?.message || String(e));
    results.push([false, '运行异常: ' + (e?.message || String(e))]);
  } finally {
    await stepCleanup();
  }
  const passed = results.filter((r) => r[0]).length;
  const total = results.length;
  log(`\n=== 结果：${passed}/${total} 通过 ===`);
  if (passed !== total) {
    log('失败项：');
    for (const [ok, name] of results) if (!ok) log(' - ' + name);
    process.exit(1);
  }
}

main();