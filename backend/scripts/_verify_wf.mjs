/** 校验：列出当前组织下所有工作流，确认导入的 SQL 查询智能体可见。 */
const BASE = 'http://localhost:3000/api';

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: '123456' }),
}).then((r) => r.json());
const token = login.data.accessToken;

const list = await fetch(`${BASE}/workflows`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

console.log('工作流列表总数:', list.data?.length);
for (const w of list.data || []) {
  console.log(`  - ${w.name}  [${w.status}]  v${w.version}  id=${w.id}`);
}
