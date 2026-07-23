import http from 'http';
function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => {
      let buf = ''; res.setEncoding('utf-8');
      res.on('data', (c) => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

const login = await req({ host: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': 41 } },
  JSON.stringify({ username: 'admin', password: '123456' }));
const token = JSON.parse(login.body).data.accessToken;
const auth = { 'Authorization': 'Bearer ' + token };
console.log('TOKEN OK, len=', token.length);

console.log('\n=== Race: 发长消息 + 流中 DELETE ===');
const data = JSON.stringify({ message: '请详细介绍一下人工智能的发展历史，包括关键人物和事件，至少 800 字。' });
let convId = null;
let sseResolve;
const sseP = new Promise((res) => { sseResolve = res; });
const r = http.request({ host: 'localhost', port: 3000, path: '/api/chat', method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json', 'Accept': 'text/event-stream', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
  console.log('chat HTTP=', res.statusCode);
  let buf = '';
  res.setEncoding('utf-8');
  res.on('data', (c) => {
    buf += c;
    const events = buf.split('\n\n');
    buf = events.pop() || '';
    for (const e of events) {
      const line = e.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const d = JSON.parse(line.slice(6));
      if (d.conversationId) { convId = d.conversationId; console.log('  收到 convId=', convId); }
      else if (d.done) { console.log('  [DONE]'); sseResolve(); }
    }
  });
  res.on('end', sseResolve);
});
r.on('error', (e) => { console.log('  chat error:', e.message); sseResolve(); });
r.write(data); r.end();

// 拿到 convId 后 50ms 立刻 DELETE
setTimeout(async () => {
  if (!convId) return console.log('  DELETE skipped: no convId yet');
  console.log('  DELETE during streaming...');
  const del = await req({ host: 'localhost', port: 3000, path: '/api/chat/conversations/' + convId, method: 'DELETE', headers: auth });
  console.log('  DELETE HTTP=', del.status);
}, 50);

// 等 SSE 完成
await sseP;
console.log('\n  SSE 流结束，等待 on(end) 异步处理...');
await new Promise((r) => setTimeout(r, 2000));

// 验证后端还活着
const h = await req({ host: 'localhost', port: 3000, path: '/api/health', method: 'GET' });
console.log('\n健康检查 HTTP=', h.status, '→', h.body.slice(0, 80));

// 二次登录
const re = await req({ host: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': 41 } },
  JSON.stringify({ username: 'admin', password: '123456' }));
console.log('二次登录 HTTP=', re.status, '↑ 之前会崩到 502/连接拒绝');
