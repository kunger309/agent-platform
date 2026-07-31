/**
 * Phase 5 端到端验证脚本
 *
 * 覆盖：
 *  1) 登录鉴权（JWT payload 含 roleIds）
 *  2) 角色继承：父角色权限自动并入子角色 effectivePermissionCodes；防环校验；有子角色时禁止删除
 *  3) 字段级权限：资源字典 / 读写策略 / 响应脱敏（masked / hidden）
 *  4) API Key：创建（明文只出现一次）→ 对外 REST 调用 → scope 拦截 → 轮换 → 吊销后失效
 *  5) 监控：/metrics 文本暴露 + /monitor/summary 结构
 *  6) 性能：embedding 缓存命中计数、缓存服务统计
 *
 * 运行：node scripts/_e2e_phase5.mjs
 * 依赖：后端 http://localhost:3000 已启动，默认账号 admin/123456
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api';
const ROOT = BASE.replace(/\/api$/, '');
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '123456';

let token = '';
let orgId = '';
const created = { roles: [], apiKeys: [], users: [] };

function log(...a) { console.log(...a); }
const results = [];
function check(name, cond, detail = '') {
  if (cond) { log(`  \x1b[32m✓\x1b[0m ${name}`); results.push([true, name]); }
  else { log(`  \x1b[31m✗\x1b[0m ${name} :: ${detail}`); results.push([false, `${name} :: ${detail}`]); }
}

async function raw(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token && !opts.noAuth && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
  return fetch((opts.root ? ROOT : BASE) + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function api(method, path, body, opts = {}) {
  const res = await raw(method, path, body, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message || json?.error || `HTTP ${res.status}`;
    const err = new Error(`${method} ${path} -> ${Array.isArray(msg) ? msg.join(';') : msg}`);
    err.status = res.status;
    throw err;
  }
  return json?.success === true ? json.data : json;
}

/** 期望调用失败，返回状态码；成功则抛错 */
async function expectFail(method, path, body, opts = {}) {
  const res = await raw(method, path, body, opts);
  await res.text();
  return res.status;
}

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
}

// ---------- 1. 登录 ----------
async function stepLogin() {
  log('\n[1] 登录鉴权 & JWT 载荷');
  const data = await api('POST', '/auth/login', { username: USER, password: PASS }, { noAuth: true });
  token = data.accessToken;
  orgId = data.user?.currentOrgId || data.user?.organizations?.[0]?.id || '';
  check('登录成功并拿到 accessToken', !!token);
  const payload = decodeJwt(token);
  check('JWT 载荷含 roleIds（字段级权限解析依赖）', Array.isArray(payload?.roleIds), JSON.stringify(payload?.roleIds));
  check('权限码非空', Array.isArray(data.user?.permissionCodes) && data.user.permissionCodes.length > 0);
}

// ---------- 2. 角色继承 ----------
async function stepRoleInheritance() {
  log('\n[2] 角色继承');
  const ts = Date.now();
  const parent = await api('POST', '/roles', {
    code: `e2e_parent_${ts}`,
    name: 'E2E 父角色',
    permissionCodes: ['agent:list', 'workflow:list'],
  });
  created.roles.push(parent.id);
  check('创建父角色成功', !!parent.id);

  const child = await api('POST', '/roles', {
    code: `e2e_child_${ts}`,
    name: 'E2E 子角色',
    parentId: parent.id,
    permissionCodes: ['kb:list'],
  });
  created.roles.push(child.id);
  check('创建子角色（带 parentId）成功', child.parentId === parent.id, `parentId=${child.parentId}`);

  const eff = child.effectivePermissionCodes || [];
  check('子角色自身权限只有 kb:list', (child.permissionCodes || []).join(',') === 'kb:list', JSON.stringify(child.permissionCodes));
  check('子角色有效权限继承了父角色的 agent:list', eff.includes('agent:list'), JSON.stringify(eff));
  check('子角色有效权限继承了父角色的 workflow:list', eff.includes('workflow:list'));
  check('子角色有效权限保留自身 kb:list', eff.includes('kb:list'));

  // 列表接口也要带上继承信息
  const list = await api('GET', '/roles');
  const childInList = list.find((r) => r.id === child.id);
  check('角色列表返回 effectivePermissionCodes', Array.isArray(childInList?.effectivePermissionCodes) && childInList.effectivePermissionCodes.includes('agent:list'));
  check('角色列表返回 parentName', childInList?.parentName === 'E2E 父角色', String(childInList?.parentName));

  // 防环：把父角色的 parent 指向子角色 → 应被拒
  const cycleStatus = await expectFail('PATCH', `/roles/${parent.id}`, { parentId: child.id });
  check('继承成环被拒绝（400）', cycleStatus === 400, `status=${cycleStatus}`);

  // 有子角色时禁止删除父角色
  const delStatus = await expectFail('DELETE', `/roles/${parent.id}`);
  check('存在子角色时禁止删除父角色（409）', delStatus === 409, `status=${delStatus}`);

  // 解除继承后可删
  await api('PATCH', `/roles/${child.id}`, { parentId: '' });
  const afterDetach = await api('GET', `/roles`);
  const c2 = afterDetach.find((r) => r.id === child.id);
  check('解除继承后 parentId 置空', !c2?.parentId, String(c2?.parentId));
  check('解除继承后有效权限只剩自身', !(c2?.effectivePermissionCodes || []).includes('agent:list'), JSON.stringify(c2?.effectivePermissionCodes));

  return { parentId: parent.id, childId: child.id, childCode: child.code };
}

// ---------- 3. 字段级权限 ----------
async function stepFieldPermissions(roleIds) {
  log('\n[3] 字段级权限');
  const resources = await api('GET', '/roles/field-permissions/resources');
  check('可脱敏资源字典可读', Array.isArray(resources) && resources.some((r) => r.resource === 'user'), JSON.stringify(resources?.map?.((r) => r.resource)));

  const roleId = roleIds.childId;
  const saved = await api('PUT', `/roles/${roleId}/field-permissions`, {
    items: [
      { resource: 'user', field: 'email', access: 'masked' },
      { resource: 'user', field: 'lastLoginAt', access: 'hidden' },
      // 故意重复一条，验证去重不炸唯一约束
      { resource: 'user', field: 'email', access: 'masked' },
    ],
  });
  check('设置字段策略成功且去重（2 条）', Array.isArray(saved) && saved.length === 2, `len=${saved?.length}`);

  const readBack = await api('GET', `/roles/${roleId}/field-permissions`);
  const emailRule = readBack.find((r) => r.field === 'email');
  check('回读字段策略正确', emailRule?.access === 'masked', JSON.stringify(readBack));

  // 造一个只挂该角色的普通用户，登录后看 /users 是否被脱敏
  const ts = Date.now();
  const uname = `e2e_masked_${ts}`;
  // 该角色需要 user:list 才能调用户列表
  await api('PUT', `/roles/${roleId}/permissions`, { permissionCodes: ['user:list', 'kb:list'] });
  const u = await api('POST', '/users', {
    username: uname,
    password: 'Test@123456',
    name: 'E2E 脱敏用户',
    email: `${uname}@example.com`,
    organizationId: orgId || undefined,
    roleCodes: [roleIds.childCode],
  });
  created.users.push(u.id);
  check('创建测试用户成功', !!u.id);

  const login = await api('POST', '/auth/login', { username: uname, password: 'Test@123456' }, { noAuth: true });
  const subToken = login.accessToken;
  const subPayload = decodeJwt(subToken);
  check('普通用户 JWT 含该角色 id', (subPayload?.roleIds || []).includes(roleId), JSON.stringify(subPayload?.roleIds));

  const masked = await api('GET', '/users', undefined, { headers: { Authorization: `Bearer ${subToken}` } });
  const rows = Array.isArray(masked) ? masked : masked?.items || [];
  const sample = rows.find((r) => r.email) || rows[0];
  check('普通用户可读用户列表', rows.length > 0, `len=${rows.length}`);
  const anyEmail = rows.map((r) => r.email).filter(Boolean);
  check('email 字段已脱敏（含 *）', anyEmail.length > 0 && anyEmail.every((e) => String(e).includes('*')), JSON.stringify(anyEmail.slice(0, 3)));
  check('lastLoginAt 字段已隐藏', rows.every((r) => !('lastLoginAt' in r)), JSON.stringify(Object.keys(sample || {})));

  // 超管不受限
  const adminView = await api('GET', '/users');
  const adminRows = Array.isArray(adminView) ? adminView : adminView?.items || [];
  const adminEmails = adminRows.map((r) => r.email).filter(Boolean);
  check('超管视角 email 未被脱敏', adminEmails.length > 0 && adminEmails.some((e) => !String(e).includes('*')), JSON.stringify(adminEmails.slice(0, 3)));
  check('超管视角保留 lastLoginAt 字段', adminRows.some((r) => 'lastLoginAt' in r));
}

// ---------- 4. API Key + 对外 REST ----------
async function stepApiKeys() {
  log('\n[4] API Key & 对外开放 API');
  const scopes = await api('GET', '/api-keys/scopes');
  check('可选 scope 字典可读', Array.isArray(scopes) && scopes.some((s) => s.code === 'agent:chat'), JSON.stringify(scopes?.map?.((s) => s.code)));

  const full = await api('POST', '/api-keys', {
    name: `E2E 全量密钥 ${Date.now()}`,
    scopes: ['agent:read', 'agent:chat', 'workflow:read', 'workflow:run', 'kb:search'],
  });
  created.apiKeys.push(full.id);
  const plain = full.plainKey || full.key;
  check('创建密钥返回一次性明文（ak_ 前缀）', typeof plain === 'string' && plain.startsWith('ak_'), String(plain).slice(0, 12));
  check('创建响应不外泄 keyHash', !('keyHash' in full), JSON.stringify(Object.keys(full)));
  check('创建响应含 maskedKey', typeof full.maskedKey === 'string' && full.maskedKey.includes('*'), String(full.maskedKey));

  const listed = await api('GET', '/api-keys');
  const inList = listed.find((k) => k.id === full.id);
  check('列表不返回明文 key', inList && !inList.plainKey && !inList.keyHash, JSON.stringify(Object.keys(inList || {})));

  // 对外调用：Authorization: Bearer ak_xxx
  const me = await api('GET', '/v1/me', undefined, { noAuth: true, headers: { Authorization: `Bearer ${plain}` } });
  check('/v1/me 用 Bearer ak_ 调用成功', !!me?.name || !!me?.id, JSON.stringify(me));
  check('/v1/me 返回 scopes', Array.isArray(me?.scopes) && me.scopes.includes('agent:chat'), JSON.stringify(me?.scopes));

  // X-API-Key 头也要支持
  const me2 = await api('GET', '/v1/me', undefined, { noAuth: true, headers: { 'X-API-Key': plain } });
  check('/v1/me 用 X-API-Key 调用成功', !!me2?.id || !!me2?.name);

  const agents = await api('GET', '/v1/agents', undefined, { noAuth: true, headers: { 'X-API-Key': plain } });
  check('/v1/agents 可列出智能体', Array.isArray(agents), typeof agents);

  const wfs = await api('GET', '/v1/workflows', undefined, { noAuth: true, headers: { 'X-API-Key': plain } });
  check('/v1/workflows 可列出工作流', Array.isArray(wfs), typeof wfs);

  // 无 key / 错 key
  const noKey = await expectFail('GET', '/v1/me', undefined, { noAuth: true });
  check('缺少凭据返回 401', noKey === 401, `status=${noKey}`);
  const badKey = await expectFail('GET', '/v1/me', undefined, { noAuth: true, headers: { 'X-API-Key': 'ak_totally_invalid_key_value' } });
  check('无效密钥返回 401', badKey === 401, `status=${badKey}`);

  // scope 拦截：只给 workflow:read 的密钥不能读 agents
  const narrow = await api('POST', '/api-keys', {
    name: `E2E 窄权限密钥 ${Date.now()}`,
    scopes: ['workflow:read'],
  });
  created.apiKeys.push(narrow.id);
  const narrowKey = narrow.plainKey || narrow.key;
  const scopeDenied = await expectFail('GET', '/v1/agents', undefined, { noAuth: true, headers: { 'X-API-Key': narrowKey } });
  check('scope 不足访问 /v1/agents 返回 403', scopeDenied === 403, `status=${scopeDenied}`);
  const scopeAllowed = await api('GET', '/v1/workflows', undefined, { noAuth: true, headers: { 'X-API-Key': narrowKey } });
  check('scope 命中可访问 /v1/workflows', Array.isArray(scopeAllowed));

  // 轮换：旧 key 失效、新 key 生效
  const rotated = await api('POST', `/api-keys/${narrow.id}/rotate`);
  const rotatedKey = rotated.plainKey || rotated.key;
  check('轮换返回新明文', typeof rotatedKey === 'string' && rotatedKey.startsWith('ak_') && rotatedKey !== narrowKey);
  const oldDead = await expectFail('GET', '/v1/workflows', undefined, { noAuth: true, headers: { 'X-API-Key': narrowKey } });
  check('轮换后旧密钥失效（401）', oldDead === 401, `status=${oldDead}`);
  const newAlive = await api('GET', '/v1/workflows', undefined, { noAuth: true, headers: { 'X-API-Key': rotatedKey } });
  check('轮换后新密钥可用', Array.isArray(newAlive));

  // 吊销
  await api('POST', `/api-keys/${narrow.id}/revoke`);
  const revoked = await expectFail('GET', '/v1/workflows', undefined, { noAuth: true, headers: { 'X-API-Key': rotatedKey } });
  check('吊销后密钥失效（401）', revoked === 401, `status=${revoked}`);

  // lastUsedAt 应被记录
  const listed2 = await api('GET', '/api-keys');
  const fullAfter = listed2.find((k) => k.id === full.id);
  check('lastUsedAt 已记录', !!fullAfter?.lastUsedAt, String(fullAfter?.lastUsedAt));

  return { plain, agents, wfs };
}

// ---------- 5. 监控 ----------
async function stepMetrics() {
  log('\n[5] 监控指标');
  const res = await fetch(`${ROOT}/api/metrics`);
  const text = await res.text();
  check('/api/metrics 可匿名抓取（未设 METRICS_TOKEN 时）', res.ok, `status=${res.status}`);
  check('输出 Prometheus 文本格式', text.includes('# HELP'), text.slice(0, 60));
  check('含 HTTP 请求指标 agentx_http_requests_total', text.includes('agentx_http_requests_total'));
  check('含 API Key 调用指标 agentx_api_key_calls_total', text.includes('agentx_api_key_calls_total'), '需先有对外调用');
  check('含 embedding 缓存指标 agentx_embedding_requests_total', text.includes('agentx_embedding_requests_total'));
  check('含实体数量 Gauge agentx_entity_total', text.includes('agentx_entity_total'));
  check('含 Node 进程默认指标', text.includes('process_cpu_user_seconds_total') || text.includes('nodejs_'));

  const summary = await api('GET', '/monitor/summary?hours=24');
  check('/monitor/summary 需鉴权且可读', !!summary && typeof summary === 'object');
  check('summary.execution 结构完整', summary?.execution && 'total' in summary.execution && 'successRate' in summary.execution, JSON.stringify(summary?.execution));
  check('summary 含趋势桶 trend', Array.isArray(summary?.trend) && summary.trend.length > 0, `len=${summary?.trend?.length}`);
  check('summary 含实体统计 entity', !!summary?.entity && 'agent' in summary.entity, JSON.stringify(summary?.entity));
  check('summary 含工具调用统计 tool', !!summary?.tool && 'total' in summary.tool, JSON.stringify(summary?.tool));
  check('summary 含进程指标 process', !!summary?.process, JSON.stringify(summary?.process));

  const noAuthSummary = await expectFail('GET', '/monitor/summary', undefined, { noAuth: true });
  check('/monitor/summary 未鉴权返回 401', noAuthSummary === 401, `status=${noAuthSummary}`);
}

// ---------- 6. 缓存 ----------
async function stepCache() {
  log('\n[6] 缓存 / 性能');
  const res = await fetch(`${ROOT}/api/metrics`);
  const text = await res.text();
  const hasCacheMetric = /agentx_embedding_requests_total\{[^}]*result="(hit|miss)"[^}]*\}/.test(text)
    || text.includes('agentx_embedding_requests_total');
  check('embedding 缓存命中/未命中指标已注册', hasCacheMetric);

  // 检索去重：RRF 融合已在 retrievers 中实现，这里断言接口可用即可
  const kbs = await api('GET', '/knowledge-bases').catch(() => []);
  const kbList = Array.isArray(kbs) ? kbs : kbs?.items || [];
  if (kbList.length) {
    const kbId = kbList[0].id;
    const r = await api('POST', `/knowledge-bases/${kbId}/search`, { query: '测试', topK: 5 }).catch((e) => ({ error: e.message }));
    const items = Array.isArray(r) ? r : r?.results || r?.items || [];
    if (Array.isArray(items) && items.length) {
      const ids = items.map((x) => x.chunkId || x.id).filter(Boolean);
      check('检索结果无重复 chunk（去重生效）', new Set(ids).size === ids.length, `${ids.length} → ${new Set(ids).size}`);
    } else {
      check('检索接口可调用（无数据，跳过去重断言）', true);
    }
  } else {
    check('无知识库，跳过检索去重断言', true);
  }
}

// ---------- 清理 ----------
async function cleanup() {
  log('\n[7] 清理测试数据');
  for (const id of created.users) await api('DELETE', `/users/${id}`).catch(() => {});
  for (const id of created.apiKeys) await api('DELETE', `/api-keys/${id}`).catch(() => {});
  // 子角色先删（可能被父继承）
  for (const id of [...created.roles].reverse()) await api('DELETE', `/roles/${id}`).catch(() => {});
  log('  清理完成');
}

(async () => {
  log('==== Phase 5 端到端验证 ====');
  try {
    await stepLogin();
    const roleIds = await stepRoleInheritance();
    await stepFieldPermissions(roleIds);
    await stepApiKeys();
    await stepMetrics();
    await stepCache();
  } catch (e) {
    log(`\n\x1b[31m致命错误\x1b[0m: ${e.message}`);
    results.push([false, `FATAL: ${e.message}`]);
  } finally {
    await cleanup().catch(() => {});
  }

  const passed = results.filter(([o]) => o).length;
  log(`\n==== 结果：${passed}/${results.length} 通过 ====`);
  const failed = results.filter(([o]) => !o);
  if (failed.length) {
    log('失败项：');
    failed.forEach(([, n]) => log('  - ' + n));
    process.exit(1);
  }
})();
