/**
 * 工作流 SQL 上下文：业务表速查表
 *
 * 用途：LLM 节点开启「数据库上下文」开关时，自动把这份表清单拼到 systemPrompt 里，
 *       让 LLM 在生成 SQL 时能直接看到"哪些表能用、各自表达什么业务概念、关键字段是什么"。
 *
 * 维护原则：
 * 1) 范围必须 ≤ 后端白名单（见 backend/src/internal/sql/sql.constants.ts）——超出白名单会 400
 * 2) 只列与"业务查询意图"最相关的字段，过滤 id/createdAt/updatedAt/外键等无关信息
 * 3) 每个表写明业务含义（desc），让 LLM 知道"组织数量"应该查 organizations 而不是 workflows.organization_id
 *
 * 修改任一表名 / 字段名时，需要同步后端 sql.constants.ts 的 ALLOWED_TABLES 和 Prisma schema。
 */
export const DB_SCHEMA = [
  {
    table: 'users',
    cn: '用户',
    desc: '系统用户（登录账号、昵称、邮箱、手机、状态）',
    keyFields: ['username', 'name', 'email', 'phone', 'status', 'isActive', 'lastLoginAt'],
    countsAs: '用户数 = SELECT count(*) FROM users',
  },
  {
    table: 'organizations',
    cn: '组织',
    desc: '组织/部门（树形结构）。"组织的个数"应直接 count(*) 这张表，不要去数 workflows.organization_id 这种关联字段',
    keyFields: ['id', 'name', 'code', 'parentId', 'path', 'level', 'status'],
    countsAs: '组织数 = SELECT count(*) FROM organizations；按父级分组 = GROUP BY parent_id',
  },
  {
    table: 'user_organizations',
    cn: '用户-组织关联',
    desc: '多对多关联表：哪些用户属于哪些组织',
    keyFields: ['userId', 'organizationId', 'role'],
  },
  {
    table: 'roles',
    cn: '角色',
    desc: 'RBAC 角色（管理员/普通用户/访客等）',
    keyFields: ['name', 'code', 'description'],
  },
  {
    table: 'permissions',
    cn: '权限点',
    desc: '权限粒度（菜单/按钮/接口级别）',
    keyFields: ['name', 'code', 'type', 'parentId'],
  },
  {
    table: 'agents',
    cn: '智能体',
    desc: 'AI Agent 实体（系统/组织/个人三级）',
    keyFields: ['name', 'description', 'scope', 'ownerId', 'organizationId', 'status'],
  },
  {
    table: 'agent_versions',
    cn: '智能体版本',
    desc: '智能体的多版本（systemPrompt / 技能绑定）',
    keyFields: ['agentId', 'version', 'systemPrompt'],
  },
  {
    table: 'agent_skills',
    cn: '智能体-技能关联',
    desc: '多对多关联表',
    keyFields: ['agentId', 'skillId'],
  },
  {
    table: 'skills',
    cn: '技能',
    desc: '技能市场里的技能（function 函数 / openapi 外部 API）',
    keyFields: ['name', 'type', 'description', 'status'],
  },
  {
    table: 'knowledge_bases',
    cn: '知识库',
    desc: '知识库元数据',
    keyFields: ['name', 'description', 'ownerId', 'organizationId'],
  },
  {
    table: 'documents',
    cn: '文档',
    desc: '知识库里的文档（file_name、解析状态、分块数）',
    keyFields: ['kbId', 'originalName', 'parseStatus', 'chunkCount', 'sizeBytes'],
  },
  {
    table: 'document_chunks',
    cn: '文档切片',
    desc: '文档被切分后的片段（用于 RAG 检索）',
    keyFields: ['documentId', 'kbId', 'chunkIndex', 'content'],
  },
  {
    table: 'conversations',
    cn: '对话会话',
    desc: '智能对话里的会话（一对多消息）',
    keyFields: ['title', 'userId', 'agentId', 'kbId', 'mode'],
  },
  {
    table: 'messages',
    cn: '消息',
    desc: '会话里的消息（用户/助手/系统）',
    keyFields: ['conversationId', 'role', 'content', 'status'],
  },
  {
    table: 'workflows',
    cn: '工作流',
    desc: '工作流定义（**注意**：workflows 表里 organization_id 是"工作流归属的组织"，不是"系统组织数"）',
    keyFields: ['name', 'description', 'scope', 'ownerId', 'organizationId', 'status'],
  },
  {
    table: 'executions',
    cn: '执行记录',
    desc: '工作流 / 智能体 / 技能的运行实例',
    keyFields: ['workflowId', 'userId', 'agentId', 'status', 'durationMs'],
  },
  {
    table: 'execution_logs',
    cn: '执行日志',
    desc: '每个节点 / 每个 step 的执行轨迹',
    keyFields: ['executionId', 'nodeId', 'level', 'message'],
  },
  {
    table: 'llm_providers',
    cn: '模型提供商',
    desc: 'LLM 提供商配置（OpenAI/DeepSeek/MiniMax 等）',
    keyFields: ['name', 'providerType', 'defaultModel', 'isDefault'],
  },
];

/**
 * 生成可塞进 LLM systemPrompt 的紧凑文本。
 * 体积控制：约 1.5 KB，对小上下文模型（如 gpt-4o-mini）也安全。
 */
export function buildDbSchemaPrompt() {
  const lines = [
    '【数据库上下文】回答涉及"业务数据"问题时，**必须**按下面的表清单选表，禁止猜表名或编造字段。',
    '',
    '⚠️ 关键提醒：',
    '- "组织的个数 / 公司数量" → `SELECT count(*) FROM organizations`（直接 count 主表）',
    '- **不要**用 `count(distinct organization_id) FROM workflows` 这种"通过关联字段数"——它只能数到该组织下有工作流的数量，不是系统组织总数',
    '- 同理："用户数"用 `count(*) FROM users` 而不是 `count(distinct user_id) FROM messages`',
    '',
    '可查询的表（与后端白名单完全一致）：',
  ];
  for (const t of DB_SCHEMA) {
    lines.push(`- \`${t.table}\` — ${t.desc} | 关键字段: ${t.keyFields.join(', ')}`);
  }
  lines.push('');
  lines.push(
    '【输出要求】只输出一条合法的 SELECT/WITH 语句（以分号结尾可选），不夹带任何解释。',
    '下游 HTTP 节点会原样 POST 到 /api/internal/sql/query，所在机不通过则返回 400。',
  );
  return lines.join('\n');
}
