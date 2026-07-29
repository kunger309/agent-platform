/**
 * 把 docs/workflow-examples/sql-query-agent.json 作为一条平台工作流导入数据库。
 * 流程：admin 登录 → 查重（按同名）→ 不存在则创建 / 已存在则更新 graphJson → 发布（published）。
 * 幂等：重复执行不会新增重复记录。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://localhost:3000/api';
const EXAMPLE = path.resolve(
  'E:/vue3-project/agent-platform/docs/workflow-examples/sql-query-agent.json',
);

const NAME = 'SQL 查询智能体';
const DESC =
  '示例工作流：自然语言 → 生成只读 SQL → 查询数据库（内部只读网关）→ 格式化回答。';

async function main() {
  const graph = JSON.parse(await readFile(EXAMPLE, 'utf8'));

  // 1) 登录
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  });
  const loginJson = await loginRes.json();
  if (!loginJson?.success) {
    console.error('❌ 登录失败:', loginJson);
    process.exit(1);
  }
  const token = loginJson.data.accessToken;
  const auth = { Authorization: `Bearer ${token}` };
  console.log('✓ 登录成功 (org=%s)', loginJson.data.user.currentOrgId);

  // 2) 查重
  const listRes = await fetch(`${BASE}/workflows`, { headers: auth });
  const listJson = await listRes.json();
  const existing = (listJson.data || []).find((w) => w.name === NAME);

  let wf;
  if (existing) {
    console.log('· 已存在同名工作流 %s，更新 graphJson', existing.id);
    const upRes = await fetch(`${BASE}/workflows/${existing.id}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: DESC, graphJson: graph }),
    });
    wf = (await upRes.json()).data;
  } else {
    const crRes = await fetch(`${BASE}/workflows`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: NAME, description: DESC, graphJson: graph }),
    });
    const crJson = await crRes.json();
    if (!crJson?.success) {
      console.error('❌ 创建工作流失败:', crJson);
      process.exit(1);
    }
    wf = crJson.data;
    console.log('✓ 已创建工作流 %s', wf.id);
  }

  // 3) 发布
  const pubRes = await fetch(`${BASE}/workflows/${wf.id}/publish`, {
    method: 'POST',
    headers: auth,
  });
  const pubJson = await pubRes.json();
  console.log(
    '✓ 发布: %s (status=%s)',
    pubJson.success ? 'OK' : 'FAIL',
    pubJson.data?.status,
  );

  // 4) 校验：取回详情确认 graphJson 已落库
  const detailRes = await fetch(`${BASE}/workflows/${wf.id}`, { headers: auth });
  const detailJson = await detailRes.json();
  const g = detailJson.data?.graphJson;
  console.log(
    '✓ 校验: 节点数=%d 边数=%d',
    g?.nodes?.length ?? 0,
    g?.edges?.length ?? 0,
  );

  console.log('\n🎉 导入完成 → workflow id=%s  name="%s"', wf.id, wf.name);
}

main().catch((e) => {
  console.error('❌ 异常:', e);
  process.exit(1);
});
