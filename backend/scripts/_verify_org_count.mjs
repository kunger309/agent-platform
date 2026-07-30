import 'dotenv/config';

const BASE = process.env.BACKEND_URL || 'http://localhost:3000';
const WF_ID = process.argv[2] || 'cms42iaj70004gi4zcue59xeo';
const QUESTION = process.argv[3] || '系统中有多少个组织？';

async function login() {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  });
  const j = await r.json();
  return j.data?.accessToken || j.accessToken;
}

(async () => {
  const token = await login();
  console.log('token ok, 触发工作流', WF_ID, '问题:', QUESTION);
  const res = await fetch(`${BASE}/api/workflows/${WF_ID}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
    body: JSON.stringify({ input: QUESTION }),
  });
  if (!res.ok) { console.error('runs 失败', res.status, await res.text()); process.exit(1); }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sql = '';
  let finalAnswer = '';
  let httpResult = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
        if (ev.type === 'node_output' || ev.type === 'node_token') {
          const o = ev.output ?? ev.data ?? ev;
          const s = JSON.stringify(o);
          if (/select|count|organization/i.test(s) && !sql) sql = s.slice(0, 600);
        }
        if (ev.type === 'node_event' && /organization|count/i.test(JSON.stringify(ev))) {
          httpResult = JSON.stringify(ev).slice(0, 400);
        }
        if (ev.type === 'done') {
          finalAnswer = JSON.stringify(ev).slice(0, 800);
        }
        // 任何含 SELECT 的片段都打印，便于核验
        if (typeof line === 'string' && /SELECT|count\(\*\)|organizations/i.test(line)) {
          // noop，上面已收集
        }
      }
    }
  }
  console.log('\n===== 提取到的关键信息 =====');
  console.log('n1 生成的 SQL(片段):', sql || '(未在事件中找到)');
  console.log('HTTP 节点结果:', httpResult || '(未捕获)');
  console.log('最终事件:', finalAnswer || '(无)');
})();
