/**
 * 带断线重连的 SSE 流式请求（基于 fetch + ReadableStream，支持 POST）
 *
 * 为什么不用原生 EventSource：
 *   EventSource 只支持 GET、不能带自定义请求头（拿不到 Authorization），
 *   而本平台的对话/工作流流式接口都是 POST + Bearer token。
 *
 * 重连策略（关键约束：后端不支持从偏移量续传，重放会重复计费且内容会重复）：
 *   - 「还没吐出任何内容」就断了  → 视为连接建立失败，安全地自动重试（指数退避 + 抖动）
 *   - 「已经吐了一部分」才断      → 不自动重放，回调 onInterrupted 让 UI 提示「回答未完成，可重新发送」
 *   - HTTP 4xx（鉴权/参数错误）    → 不重试，直接报错
 *   - 主动 abort                  → 不重试，不报错
 *
 * @param {object} opts
 * @param {string} opts.url                请求地址
 * @param {object} opts.headers            请求头（不含 Accept，内部会补）
 * @param {() => any} opts.makeBody        每次尝试都重新构造 body（FormData 只能消费一次，必须用工厂函数）
 * @param {(data:any)=>void} opts.onEvent  收到一条已 JSON.parse 的 data 事件
 * @param {()=>void} [opts.onOpen]         每次成功建立连接（含重连成功）
 * @param {(n:number,delay:number)=>void} [opts.onRetry] 即将第 n 次重试，delay 毫秒后
 * @param {(receivedChars:number)=>void} [opts.onInterrupted] 中途断流且无法安全重放
 * @param {(msg:string)=>void} [opts.onError]
 * @param {()=>void} [opts.onFinish]       流正常结束（无论是否收到显式 done 事件，只调一次）
 * @param {number} [opts.maxRetries=3]
 * @returns {{ abort: () => void, get retries(): number }}
 */
export function sseStream(opts) {
  const {
    url,
    headers = {},
    makeBody,
    onEvent,
    onOpen,
    onRetry,
    onInterrupted,
    onError,
    onFinish,
    maxRetries = 3,
  } = opts;

  let controller = null;
  let aborted = false;
  let finished = false;
  let retries = 0;
  let receivedChars = 0; // 本次请求累计吐出的字符数，用于判断能否安全重放
  let retryTimer = null;

  function finishOnce() {
    if (finished) return;
    finished = true;
    onFinish?.();
  }

  /** 指数退避 + 抖动，避免服务重启时所有客户端同时冲击 */
  function backoff(n) {
    const base = Math.min(500 * 2 ** (n - 1), 8000);
    return base + Math.floor(Math.random() * 300);
  }

  async function attempt() {
    if (aborted || finished) return;
    controller = new AbortController();

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', ...headers },
        body: makeBody(),
        signal: controller.signal,
      });
    } catch (err) {
      if (aborted || err?.name === 'AbortError') return;
      // 连接层失败（断网 / 服务未起 / DNS），尚未产生任何内容 → 可安全重试
      return scheduleRetry(err?.message || '网络连接失败');
    }

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        msg = data?.message || msg;
        if (Array.isArray(msg)) msg = msg.join('；');
      } catch (_) { /* 响应不是 JSON，保留 HTTP 状态码 */ }
      // 4xx 是客户端问题（token 过期 / 参数非法），重试没有意义
      if (res.status >= 400 && res.status < 500) {
        finished = true;
        onError?.(msg);
        return;
      }
      return scheduleRetry(msg);
    }

    onOpen?.();

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let sawDone = false;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const events = buf.split('\n\n');
        buf = events.pop() || '';
        for (const evt of events) {
          // 一条事件里可能有多行 data:，SSE 规范要求按换行拼接
          const dataLines = evt
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''));
          if (!dataLines.length) continue;
          const json = dataLines.join('\n').trim();
          if (!json) continue;
          let data;
          try { data = JSON.parse(json); } catch (_) { continue; }

          if (typeof data.delta === 'string') receivedChars += data.delta.length;
          if (data.done) sawDone = true;
          onEvent?.(data);
        }
      }
    } catch (err) {
      if (aborted || err?.name === 'AbortError') return;
      // 读流中途失败：已有内容就不能重放，否则用户会看到重复的半截回答
      if (receivedChars > 0) {
        finished = true;
        onInterrupted?.(receivedChars);
        return;
      }
      return scheduleRetry(err?.message || '连接中断');
    }

    if (aborted) return;

    // 流自然结束但没收到 done：多半是服务端进程被掐或代理超时
    if (!sawDone && receivedChars === 0 && retries < maxRetries) {
      return scheduleRetry('连接被提前关闭');
    }
    if (!sawDone && receivedChars > 0) {
      finished = true;
      onInterrupted?.(receivedChars);
      return;
    }
    finishOnce();
  }

  function scheduleRetry(reason) {
    if (aborted || finished) return;
    if (retries >= maxRetries) {
      finished = true;
      onError?.(`${reason}（已重试 ${retries} 次）`);
      return;
    }
    retries += 1;
    const delay = backoff(retries);
    onRetry?.(retries, delay);
    retryTimer = setTimeout(attempt, delay);
  }

  attempt();

  return {
    abort() {
      aborted = true;
      finished = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      controller?.abort();
    },
    get retries() { return retries; },
  };
}
