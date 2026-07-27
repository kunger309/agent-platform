/**
 * 内部 SQL 查询端点的安全白名单与关键字黑名单。
 *
 * 安全模型：
 * 1) 只读 SQL：必须以 SELECT / WITH / EXPLAIN / VALUES / TABLE 开头（trim 注释后）
 * 2) 禁止多语句：不允许语句中出现额外的分号
 * 3) 关键字黑名单：禁止 INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCUE/CREATE/GRANT/REVOKE 等
 * 4) 表白名单：FROM/JOIN 引用的表必须在 ALLOWED_TABLES 中（业务只读表）
 * 5) 网络白名单：必须从本机（127.0.0.1 / ::1）调用
 * 6) 超时：5 秒
 * 7) 行数上限：最多 1000 行
 *
 * 注意：这不是为了替代数据库权限模型，而是给"工作流 HTTP 节点 → 后端内部 API"这一
 * 封闭链路提供最小可信的网关。要进入生产前仍应在 Postgres 层配 readonly role。
 */

// 允许查询的业务表（只读）。修改前请评估敏感性。
export const ALLOWED_TABLES: ReadonlySet<string> = new Set([
  'users',
  'organizations',
  'user_organizations',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'llm_providers',
  'agents',
  'agent_versions',
  'agent_skills',
  'skills',
  'skill_versions',
  'knowledge_bases',
  'documents',
  'document_chunks',
  'conversations',
  'messages',
  'workflows',
  'executions',
  'execution_logs',
  'files',
  'api_keys',
  'audit_logs',
]);

// 不允许出现在 SQL 中的关键字（不区分大小写，按词边界匹配）。
// 覆盖：写操作 / DDL / 函数式执行 / 文件操作 / 提权 / 事务控制
export const FORBIDDEN_KEYWORDS: readonly string[] = [
  'insert',
  'update',
  'delete',
  'drop',
  'alter',
  'truncate',
  'create',
  'grant',
  'revoke',
  'copy',
  'vacuum',
  'reindex',
  'cluster',
  'lock',
  'comment',
  'set',
  'reset',
  'call',
  'do',
  'notify',
  'listen',
  'unlisten',
  'load',
  'security',
  'definer',
  'returning',
  'into',
  'outfile',
  'dumpfile',
  'pg_read_file',
  'pg_write_file',
  'pg_ls_dir',
];

// 允许的语句开头（trim 注释后，取第一个 token）
export const ALLOWED_PREFIXES: readonly string[] = [
  'select',
  'with',
  'explain',
  'values',
  'table',
];

export const MAX_SQL_LENGTH = 2000;
export const MAX_ROWS = 1000;
export const QUERY_TIMEOUT_MS = 5000;

// 来源 IP 白名单（HTTP 节点 fetch localhost 时连接到的远端地址）
export const ALLOWED_IPS: readonly string[] = [
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
];