/**
 * 简易模板插值：把 {{ input }} / {{ output }} / {{ variables.x }} / {{ artifacts.x }}
 * 替换为当前图状态里的对应值。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function interpolate(template: string, state: any): string {
  if (!template) return '';
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const val = getPath(state, path);
    return val == null ? '' : String(val);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPath(obj: any, path: string): any {
  if (!obj) return undefined;
  if (path === 'input') return obj.input;
  if (path === 'output') return obj.output;
  if (path.startsWith('variables.')) return obj.variables?.[path.slice('variables.'.length)];
  if (path.startsWith('artifacts.')) return obj.artifacts?.[path.slice('artifacts.'.length)];
  // 形如 nodeId.output / nodeId.field 的"按节点引用"：优先取 variables["nodeId.output"]，
  // 使 {{n1.output}} 等价于 {{variables.n1.output}}，对前端用户更友好。
  if (obj.variables && Object.prototype.hasOwnProperty.call(obj.variables, path)) {
    return obj.variables[path];
  }
  // 否则按点号逐层遍历（如 a.b.c）
  return path.split('.').reduce((o: any, k: string) => (o == null ? undefined : o[k]), obj);
}
