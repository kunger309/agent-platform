import * as yaml from 'js-yaml';

export interface OpenApiParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'body';
  required: boolean;
  type: string;
  description?: string;
}

export interface OpenApiToolSpec {
  operationId: string; // 唯一名（作为 tool name）
  name: string; // 展示名
  description: string;
  method: string; // GET / POST ...
  path: string; // /pets/{id}
  serverUrl: string; // base url
  parameters: OpenApiParam[];
}

/**
 * 解析 OpenAPI 文档（JSON 字符串 / YAML 字符串 / 已解析对象）→ JS 对象
 */
export function parseOpenApiDocument(raw: string | Record<string, any>): Record<string, any> {
  if (typeof raw === 'object') return raw;
  const text = raw.trim();
  if (text.startsWith('{') || text.startsWith('[')) {
    return JSON.parse(text);
  }
  // 否则尝试 YAML
  const loaded = yaml.load(text);
  if (typeof loaded !== 'object' || loaded === null) {
    throw new Error('OpenAPI 文档解析失败：既不是合法 JSON 也不是 YAML');
  }
  return loaded as Record<string, any>;
}

function resolveRef(doc: Record<string, any>, ref: string): any {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.replace(/^#\//, '').split('/');
  let cur: any = doc;
  for (const p of parts) {
    if (cur == null) return null;
    cur = cur[p];
  }
  return cur;
}

function jsonTypeOf(schema: any): string {
  if (!schema) return 'string';
  if (schema.type) return schema.type;
  if (Array.isArray(schema.enum)) return 'string';
  if (schema.format) return schema.format;
  return 'string';
}

function buildParam(p: any, doc: Record<string, any>): OpenApiParam | null {
  const resolved = p.$ref ? resolveRef(doc, p.$ref) : p;
  if (!resolved || !resolved.name || !resolved.in) return null;
  const isBody = resolved.in === 'body' || resolved.in === 'query' && false;
  return {
    name: resolved.name,
    in: resolved.in as OpenApiParam['in'],
    required: !!resolved.required,
    type: jsonTypeOf(resolved.schema || resolved),
    description: resolved.description,
  };
  void isBody;
}

/**
 * 提取所有可调用操作 → 工具列表
 */
export function extractOpenApiTools(doc: Record<string, any>): OpenApiToolSpec[] {
  if (!doc || !doc.paths || typeof doc.paths !== 'object') {
    throw new Error('OpenAPI 文档缺少 paths 字段');
  }
  const servers = Array.isArray(doc.servers) && doc.servers.length
    ? doc.servers[0].url
    : '';
  const serverUrl = (servers || '').replace(/\/$/, '');

  const tools: OpenApiToolSpec[] = [];
  const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

  for (const [path, item] of Object.entries<any>(doc.paths)) {
    if (!item || typeof item !== 'object') continue;
    for (const method of methods) {
      const op = item[method];
      if (!op || typeof op !== 'object') continue;

      const operationId =
        op.operationId || `${method}_${path.replace(/[^\w]/g, '_')}`;
      const parameters: OpenApiParam[] = [];

      const rawParams: any[] = op.parameters || [];
      for (const p of rawParams) {
        const bp = buildParam(p, doc);
        if (bp) parameters.push(bp);
      }

      // requestBody → 作为 body 参数
      if (op.requestBody && op.requestBody.content) {
        const ct =
          op.requestBody.content['application/json'] ||
          Object.values(op.requestBody.content)[0];
        parameters.push({
          name: 'body',
          in: 'body',
          required: !!op.requestBody.required,
          type: 'object',
          description: ct?.schema ? 'JSON 请求体' : undefined,
        });
      }

      const desc =
        op.description ||
        op.summary ||
        `${method.toUpperCase()} ${path}`;

      tools.push({
        operationId,
        name: operationId,
        description: desc,
        method: method.toUpperCase(),
        path,
        serverUrl,
        parameters,
      });
    }
  }

  if (!tools.length) throw new Error('OpenAPI 文档未提取到任何可调用操作');
  return tools;
}

/**
 * 根据工具规格 + 输入参数，构造真实请求。
 * input 中的字段按参数位置（path/query/header/body）映射到请求。
 */
export function buildOpenApiRequest(
  spec: OpenApiToolSpec,
  input: Record<string, any>,
): { url: string; method: string; headers: Record<string, string>; body?: string } {
  const data = input || {};
  const headers: Record<string, string> = {};

  // 路径参数
  let url = spec.path;
  const query: string[] = [];

  for (const p of spec.parameters) {
    const val = data[p.name];
    if (val === undefined || val === null) {
      if (p.required) throw new Error(`缺少必填参数：${p.name}`);
      continue;
    }
    if (p.in === 'path') {
      url = url.replace(`{${p.name}}`, encodeURIComponent(String(val)));
    } else if (p.in === 'query') {
      query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(String(val))}`);
    } else if (p.in === 'header') {
      headers[p.name] = String(val);
    }
  }

  let fullUrl = spec.serverUrl ? spec.serverUrl + url : url;
  if (query.length) {
    fullUrl += (fullUrl.includes('?') ? '&' : '?') + query.join('&');
  }

  // body
  let body: string | undefined;
  const bodyParam = spec.parameters.find((p) => p.in === 'body');
  if (bodyParam && data[bodyParam.name] !== undefined) {
    body = JSON.stringify(data[bodyParam.name]);
    headers['Content-Type'] = 'application/json';
  }

  return { url: fullUrl, method: spec.method, headers, body };
}
