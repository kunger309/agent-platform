import * as vm from 'vm';

/**
 * 在受限沙箱中执行用户提供的 JS 函数代码。
 *
 * 安全模型（软沙箱，非硬隔离）：
 * - 仅暴露 JSON / Math / Date / Object / Array / String / Number / Boolean / RegExp / Error / console（静默）等安全全局
 * - 显式屏蔽 require / process / Buffer / fetch / 定时器 / globalThis 等危险入口
 * - 通过 vm.Script timeout 在单线程层面打断长时间/死循环执行（maxDuration 毫秒）
 *
 * 注意：Node 的 vm 不是真正的内核级隔离，有经验的攻击者仍可能通过原型链逃逸。
 * 生产环境若要更强隔离，应改用 worker_threads 子进程或 isolated-vm。本项目 Phase 4 采用软沙箱 + 超时，
 * 满足"自定义 JS 工具"的安全下限。
 */
export function runJsInSandbox(
  code: string,
  input: any,
  timeoutMs = 2000,
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: any = {
    input,
    console: {
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    // 显式屏蔽的危险全局
    require: undefined,
    process: undefined,
    Buffer: undefined,
    globalThis: undefined,
    global: undefined,
    module: undefined,
    exports: undefined,
    fetch: undefined,
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    setTimeout: undefined,
    setInterval: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,
    setImmediate: undefined,
    queueMicrotask: undefined,
    __input: input,
    __result: undefined,
  };

  vm.createContext(sandbox);
  const wrapped = 'var __result = (function(input){ ' + code + ' \n})((__input));';
  const script = new vm.Script(wrapped, { filename: 'skill.js' });
  // timeout 在整个脚本执行（含函数调用）期间生效，可打断死循环
  script.runInContext(sandbox, { timeout: timeoutMs });

  const result = sandbox.__result;
  if (result === undefined) return undefined;
  if (typeof result === 'object') return result;
  return result;
}
