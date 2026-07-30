// 创建 3 个常用 function 技能（自包含、可离线测试）+ 逐个测试验证
// 用法：node scripts/_create_common_skills.mjs
const BASE = process.env.API_BASE || 'http://localhost:3000';
const USER = process.env.ADMIN_USER || 'admin';
const PASS = process.env.ADMIN_PASS || '123456';

const fetchJson = async (url, opts = {}) => {
  const res = await fetch(BASE + url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
};

async function login() {
  const { status, data } = await fetchJson('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  if ((status !== 200 && status !== 201) || !data?.data?.accessToken) {
    throw new Error('登录失败 (' + status + '): ' + JSON.stringify(data));
  }
  return { token: data.data.accessToken };
}

// 三个技能定义
const skills = [
  {
    name: '计算器',
    description: '对两个数字做四则运算（加/减/乘/除），返回结果。入参：a、b、op。',
    type: 'function',
    schemaJson: {
      type: 'object',
      properties: {
        a: { type: 'number', description: '左操作数' },
        b: { type: 'number', description: '右操作数' },
        op: { type: 'string', enum: ['+', '-', '*', '/'], description: '运算符' },
      },
      required: ['a', 'b', 'op'],
    },
    sourceCode: `const { a, b, op } = input;
if (typeof a !== 'number' || typeof b !== 'number') return { error: 'a、b 必须是数字' };
switch (op) {
  case '+': return a + b;
  case '-': return a - b;
  case '*': return a * b;
  case '/': return b === 0 ? { error: '除数不能为 0' } : a / b;
  default: return { error: '不支持的运算符: ' + op };
}`,
    testInput: { a: 12, b: 4, op: '*' },
    expect: 48,
  },
  {
    name: '当前时间',
    description: '返回服务器当前日期/时间，可按 format 指定输出格式。入参：format 可选 date/time/datetime/iso。',
    type: 'function',
    schemaJson: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['date', 'time', 'datetime', 'iso'],
          description: '输出格式，默认 datetime',
        },
      },
    },
    sourceCode: `const now = new Date();
const f = input.format || 'datetime';
if (f === 'date') return now.toISOString().slice(0, 10);
if (f === 'time') return now.toTimeString().slice(0, 8);
if (f === 'iso') return now.toISOString();
return now.toLocaleString('zh-CN', { hour12: false });`,
    testInput: { format: 'date' },
    expectMatch: /^\d{4}-\d{2}-\d{2}$/,
  },
  {
    name: '文本分析',
    description: '统计文本的字数、词数（中文字+英文单词）、行数。入参：text。',
    type: 'function',
    schemaJson: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待分析文本' },
      },
      required: ['text'],
    },
    sourceCode: `const t = input.text || '';
const tokens = t.match(/[\\u4e00-\\u9fa5]|[a-zA-Z0-9]+/g) || [];
return {
  chars: t.length,
  charsNoSpace: t.replace(/\\s/g, '').length,
  words: tokens.length,
  lines: t ? t.split(/\\n/).length : 0,
};`,
    testInput: { text: '你好 world\n这是第二行' },
    expect: { chars: 14, charsNoSpace: 12, words: 8, lines: 2 },
  },
];

async function main() {
  const { token } = await login();
  const auth = { Authorization: `Bearer ${token}` };

  // 拉取已有技能，做幂等：同名已存在则跳过创建，只测试
  const listRes = await fetchJson('/api/skills', { headers: auth });
  const existing = (listRes.data?.data || listRes.data || []).filter((x) => x.name);
  const nameToId = Object.fromEntries(existing.map((x) => [x.name, x.id]));

  for (const s of skills) {
    let id = nameToId[s.name];
    if (id) {
      console.log(`· 「${s.name}」已存在，跳过创建（id=${id}）`);
    } else {
      // 创建技能（同时建 v1 版本）
      const createRes = await fetchJson('/api/skills', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          name: s.name,
          description: s.description,
          type: s.type,
          status: 'active',
          schemaJson: s.schemaJson,
          sourceCode: s.sourceCode,
          securityPolicy: { maxDuration: 2000 },
        }),
      });
      if (createRes.status !== 200 && createRes.status !== 201) {
        console.log(`✗ 创建「${s.name}」失败 (${createRes.status}): ${JSON.stringify(createRes.data)}`);
        continue;
      }
      id = createRes.data?.data?.id || createRes.data?.id;
      console.log(`✓ 创建「${s.name}」成功 id=${id}`);
    }

    // 测试调用（接口同样返回 201）
    const testRes = await fetchJson(`/api/skills/${id}/test`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ input: s.testInput }),
    });
    const r = testRes.data?.data || testRes.data;
    const out = r?.output;
    let ok = (testRes.status === 200 || testRes.status === 201) && r?.status === 'success';
    if (ok && s.expect !== undefined) ok = JSON.stringify(out) === JSON.stringify(s.expect);
    if (ok && s.expectMatch) ok = s.expectMatch.test(String(out));
    console.log(`  测试: status=${r?.status} durationMs=${r?.durationMs} output=${JSON.stringify(out)} ${ok ? '✓ OK' : '✗(不符预期)'}`);
  }

  // 汇总
  const summaryRes = await fetchJson('/api/skills', { headers: auth });
  const arr = summaryRes.data?.data || summaryRes.data || [];
  console.log(`\n技能市场现有 ${arr.length} 个技能：`);
  arr.forEach((k) => console.log(`  - ${k.name} [${k.type}] status=${k.status} versions=${(k.versions || []).length}`));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
