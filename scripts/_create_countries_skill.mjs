const BASE = 'http://localhost:3000';

async function http(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const openapiSchema = {
  openapi: '3.0.3',
  info: {
    title: '国家信息查询 (countries.dev)',
    version: '1.0.0',
    description: '查询世界各国信息：人口、首都、货币、语言、地区、时区、国旗等。免 key 免注册。\n基于 https://countries.dev 公开 API（REST Countries v3.1 已被官方废弃，这是免费替代品）。',
  },
  servers: [{ url: 'https://countries.dev' }],
  paths: {
    '/name/{name}': {
      get: {
        operationId: 'searchByName',
        summary: '按国家英文名搜索',
        description: '模糊匹配国家英文名（如 "china"、"japan"），返回国家对象数组',
        parameters: [
          { name: 'name', in: 'path', required: true, description: '国家英文名', schema: { type: 'string' }, example: 'china' },
          { name: 'fields', in: 'query', required: false, description: '可选字段过滤，逗号分隔（如 name,capital,region）', schema: { type: 'string' }, example: 'name,capital,region' },
        ],
        responses: { '200': { description: '国家数组' } },
      },
    },
    '/alpha/{code}': {
      get: {
        operationId: 'getByAlphaCode',
        summary: '按 ISO 国家代码查询',
        description: '支持 alpha-2 (US/CN/JP) / alpha-3 (USA/CHN/JPN) / 数字代码',
        parameters: [
          { name: 'code', in: 'path', required: true, description: 'ISO 国家代码（US/CN/USA/CHN/JPN 等）', schema: { type: 'string' }, example: 'USA' },
          { name: 'fields', in: 'query', required: false, description: '可选字段过滤', schema: { type: 'string' }, example: 'name,capital' },
        ],
        responses: { '200': { description: '国家对象' } },
      },
    },
    '/region/{region}': {
      get: {
        operationId: 'listByRegion',
        summary: '按地区列出所有国家',
        description: '返回该地区所有国家数组',
        parameters: [
          { name: 'region', in: 'path', required: true, description: '地区名', schema: { type: 'string', enum: ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania', 'Polar', 'Antarctic'] }, example: 'Asia' },
          { name: 'fields', in: 'query', required: false, description: '可选字段过滤', schema: { type: 'string' }, example: 'name,capital' },
        ],
        responses: { '200': { description: '国家数组' } },
      },
    },
    '/currency/{currency}': {
      get: {
        operationId: 'listByCurrency',
        summary: '按货币代码列出使用该货币的国家',
        parameters: [
          { name: 'currency', in: 'path', required: true, description: '货币代码（USD/CNY/JPY/EUR 等）', schema: { type: 'string' }, example: 'CNY' },
          { name: 'fields', in: 'query', required: false, description: '可选字段过滤', schema: { type: 'string' }, example: 'name,capital' },
        ],
        responses: { '200': { description: '国家数组' } },
      },
    },
    '/capital/{capital}': {
      get: {
        operationId: 'listByCapital',
        summary: '按首都城市名查询',
        parameters: [
          { name: 'capital', in: 'path', required: true, description: '首都名（如 beijing、tokyo、washington）', schema: { type: 'string' }, example: 'beijing' },
          { name: 'fields', in: 'query', required: false, description: '可选字段过滤', schema: { type: 'string' }, example: 'name,capital' },
        ],
        responses: { '200': { description: '国家数组' } },
      },
    },
  },
};

(async () => {
  console.log('1) 登录');
  const login = await http('POST', '/api/auth/login', { username: 'admin', password: '123456' });
  if (login.status >= 400) { console.error('登录失败', login); process.exit(1); }
  const token = login.body.data?.accessToken || login.body.accessToken;

  console.log('2) 清理旧的废弃技能（基于 restcountries.com v3.1）');
  const list = await http('GET', '/api/skills', null, token);
  const old = (list.body.data || list.body || []).filter((s) => s.name === '国家信息查询');
  for (const s of old) {
    const d = await http('DELETE', '/api/skills/' + s.id, null, token);
    console.log('  删除', s.id, '->', d.status);
  }

  console.log('3) 创建新技能（基于 countries.dev）');
  const created = await http('POST', '/api/skills', {
    name: '国家信息查询',
    type: 'openapi',
    description: '查询世界各国信息：人口、首都、货币、语言、地区、时区、国旗等。5 个常用操作，免 key 免注册。',
    status: 'active',
    openapiSchema,
    securityPolicy: { maxDuration: 10000 },
  }, token);
  if (created.status >= 400) { console.error('创建失败', JSON.stringify(created, null, 2)); process.exit(1); }
  const skillId = (created.body.data || created.body).id;
  console.log('  已创建 id=' + skillId);

  const cases = [
    { name: 'searchByName japan', input: { operation: 'searchByName', name: 'japan' }, expect: 'arr' },
    { name: 'searchByName + fields 过滤', input: { operation: 'searchByName', name: 'china', fields: 'name,capital,region,currencies' }, expect: 'arr' },
    { name: 'getByAlphaCode USA', input: { operation: 'getByAlphaCode', code: 'USA' }, expect: 'obj' },
    { name: 'getByAlphaCode JPN + fields', input: { operation: 'getByAlphaCode', code: 'JPN', fields: 'name,capital,languages,flag' }, expect: 'obj' },
    { name: 'listByRegion Asia', input: { operation: 'listByRegion', region: 'Asia' }, expect: 'arr' },
    { name: 'listByCurrency CNY + fields', input: { operation: 'listByCurrency', currency: 'CNY', fields: 'name,capital,currencies' }, expect: 'arr' },
    { name: 'listByCapital beijing', input: { operation: 'listByCapital', capital: 'beijing' }, expect: 'arr' },
  ];

  for (const c of cases) {
    const r = await http('POST', '/api/skills/' + skillId + '/test', { input: c.input }, token);
    const d = r.body.data || r.body;
    const out = d.output;
    const shape = Array.isArray(out) ? `arr(${out.length})` : (out && typeof out === 'object' ? 'obj' : 'n/a');
    let extra = '';
    if (Array.isArray(out) && out[0]?.name) extra = ' first=' + (typeof out[0].name === 'string' ? out[0].name : out[0].name.common || JSON.stringify(out[0].name).slice(0, 40));
    else if (out && out.name) extra = ' name=' + (typeof out.name === 'string' ? out.name : out.name.common || '');
    if (out && out.capital) extra += ' capital=' + out.capital;
    console.log(`  [${c.name}] status=${d.status} shape=${shape}${extra}`);
  }
})();
