import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 与 backend/src/internal/sql/sql.constants.ts 的 ALLOWED_TABLES 保持一致（24 张）
const ALLOWED_TABLES = [
  'users', 'organizations', 'user_organizations', 'roles', 'permissions',
  'role_permissions', 'user_roles', 'llm_providers', 'agents', 'agent_versions',
  'agent_skills', 'skills', 'skill_versions', 'knowledge_bases', 'documents',
  'document_chunks', 'conversations', 'messages', 'workflows', 'executions',
  'execution_logs', 'files', 'api_keys', 'audit_logs',
]; // 注意：严格对齐 ALLOWED_TABLES，不含 tool_invocations（SQL 端点不允许查）

const DESCRIPTIONS = {
  users: '系统用户（登录账号、昵称、邮箱、手机、状态、是否超管）',
  organizations: '组织/部门（树形结构）。"组织数量"直接 count(*) 此表，勿数 workflows.organization_id 等关联字段',
  user_organizations: '多对多关联表：哪些用户属于哪些组织',
  roles: 'RBAC 角色（管理员/普通用户/访客等）',
  permissions: '权限粒度（菜单/按钮/接口级别）',
  role_permissions: '角色与权限的多对多关联',
  user_roles: '用户与角色的多对多关联',
  llm_providers: 'LLM 提供商配置（OpenAI/DeepSeek/MiniMax 等）',
  agents: 'AI Agent 实体（系统/组织/个人三级）',
  agent_versions: '智能体的多版本（systemPrompt / 技能绑定）',
  agent_skills: '多对多关联表：agent↔skill',
  skills: '技能市场里的技能（function 函数 / openapi 外部 API）',
  skill_versions: '技能的多版本（代码 / 配置）',
  knowledge_bases: '知识库元数据',
  documents: '知识库里的文档（file_name、解析状态、分块数）',
  document_chunks: '文档被切分后的片段（用于 RAG 检索）',
  conversations: '智能对话里的会话（一对多消息）',
  messages: '会话里的消息（用户/助手/系统）',
  workflows: '工作流定义（注意 organization_id 是"工作流归属组织"，非"系统组织数"）',
  executions: '工作流 / 智能体 / 技能的运行实例',
  execution_logs: '每个节点 / 每个 step 的执行轨迹',
  tool_invocations: '技能调用记录（执行轨迹）',
  files: '文件元数据（上传的文件）',
  api_keys: 'API 密钥（对外调用的 key）',
  audit_logs: '审计日志（操作记录）',
};

async function getColumns() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
     ORDER BY table_name, ordinal_position`,
    ALLOWED_TABLES,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.table_name)) map.set(r.table_name, []);
    map.get(r.table_name).push(r.column_name);
  }
  return map;
}

function buildBlock(colsMap) {
  const hints = [
    '【关键提醒】"组织的个数 / 公司数量 / 用户数 / 智能体数"等"数实体"类问题，必须直接 count 主表，禁止通过关联字段去重数！',
    '- ✅ 组织数量 → SELECT count(*) FROM organizations',
    '- ❌ SELECT count(distinct organization_id) FROM agents    （只能数"有 agent 的组织"，非系统组织总数）',
    '- ❌ SELECT count(distinct organization_id) FROM workflows （只能数"有工作流的组织"）',
    '- ✅ 用户数 → SELECT count(*) FROM users',
    '- ❌ SELECT count(distinct user_id) FROM messages          （只能数"发过消息的用户"）',
    '- ✅ 智能体数 → SELECT count(*) FROM agents',
    '- ✅ 技能数 → SELECT count(*) FROM skills',
  ].join('\n');

  const lines = ALLOWED_TABLES.map((t) => {
    const cols = (colsMap.get(t) || []).join(', ');
    const desc = DESCRIPTIONS[t] || '';
    return `- ${t} — ${desc} | 字段: ${cols}`;
  }).join('\n');

  return `${hints}\n\nSchema（只读业务表，与后端白名单完全一致，共 ${ALLOWED_TABLES.length} 张，禁止猜测未列出的表或字段）：\n${lines}\n\n规则：\n1) 必须以 SELECT 开头；\n2) 只能查询上面列出的表；\n3) 不要包含分号结尾的多语句；\n4) 使用 count / sum / avg 等聚合函数做统计；\n5) 输出最长 200 字符。`;
}

function isSqlNode(cfg) {
  const pt = cfg?.promptTemplate || '';
  return pt.includes('只读业务表') || (pt.includes('只读 SELECT') && pt.includes('Schema'));
}

function patchPrompt(pt, block) {
  const markerUQ = '用户问题：';
  const idxUQ = pt.indexOf(markerUQ);
  const tail = idxUQ >= 0 ? pt.substring(idxUQ) : '';
  const head = idxUQ >= 0 ? pt.substring(0, idxUQ) : pt;
  let rs = head.indexOf('【关键提醒】');
  if (rs < 0) rs = head.indexOf('Schema（只读业务表）：');
  const newHead = (rs >= 0 ? head.substring(0, rs) : head).replace(/\s+$/, '');
  return `${newHead}\n\n${block}\n\n${tail}`;
}

const DRY = process.argv.includes('--apply') ? false : true;

const colsMap = await getColumns();
// 校验：白名单里是否有表在数据库不存在
const missing = ALLOWED_TABLES.filter((t) => !colsMap.has(t));
if (missing.length) console.log('⚠️ 数据库缺失的表（不在 information_schema）:', missing);

const block = buildBlock(colsMap);
console.log('\n========== 生成的 canonical schema 块预览 ==========');
console.log(block);
console.log('==================================================\n');

const wfs = await prisma.workflow.findMany({});
let patched = 0;
for (const wf of wfs) {
  let gj = wf.graphJson;
  if (typeof gj === 'string') { try { gj = JSON.parse(gj); } catch { continue; } }
  const nodes = Array.isArray(gj?.nodes) ? gj.nodes : [];
  let changed = false;
  for (const n of nodes) {
    const cfg = n?.data?.config || n?.config || {};
    if (!isSqlNode(cfg)) continue;
    const old = cfg.promptTemplate || '';
    const next = patchPrompt(old, block);
    if (next === old) continue;
    if (n?.data?.config) n.data.config.promptTemplate = next;
    else if (n?.config) n.config.promptTemplate = next;
    changed = true;
    console.log(`[${DRY ? '预览' : '执行'}] 工作流 ${wf.id} (${wf.name}) 节点 ${n.id}: promptTemplate ${old.length}→${next.length} 字符`);
  }
  if (!changed) continue;
  patched++;
  if (!DRY) {
    await prisma.workflow.update({ where: { id: wf.id }, data: { graphJson: gj } });
  }
}
console.log(`\n${DRY ? 'DRY-RUN 完成' : '已写入'}：共处理 ${patched} 个 SQL 工作流。`);
console.log(DRY ? '确认无误后加 --apply 参数重新运行以真正写入。' : '');
await prisma.$disconnect();
