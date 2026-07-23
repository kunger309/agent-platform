# AI 智能体开发平台 - 技术方案

> 项目根目录文档。后续所有架构变更、Phase 推进、关键决策统一在此维护。
>
> 原 workbuddy session 文件：`C:\Users\liukun\.workbuddy\plans\swift-beacon-lovelace.md`（仅作历史快照保留）

---

## 〇、文档元信息

- **项目代号**：agent-platform
- **项目根目录**：`E:\vue3-project\agent-platform\`
- **前端**：Vue 3 + Vite + **JS**（不引 TS） + Element Plus + Pinia + @vue-flow/core
- **后端**：NestJS 10 + TypeScript + Prisma + PostgreSQL + Redis + BullMQ
- **AI 框架**：LangChain.js（基础）+ LangGraph.js（核心编排）
- **向量库**：Qdrant（默认）+ Milvus 适配器位置（预留）
- **LLM 接入**：OpenAI 兼容协议（覆盖 OpenAI / DeepSeek / Qwen / 智谱 / Ollama）
- **目录结构**：monorepo — `frontend/` + `backend/` + `docker/`
- **部署**：Docker Compose 一键启动

---

## 一、整体架构（5 层）

```
┌─────────────────────────────────────────────────────────────────────┐
│ 客户端层 Client          浏览器（Vue 3 SPA + Element Plus）         │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ HTTPS (Nginx 网关)
┌───────────────────────────────▼─────────────────────────────────────┐
│ 网关层 Gateway            Nginx：路由 / 静态托管 / SSE 长连接        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ /api/*
┌───────────────────────────────▼─────────────────────────────────────┐
│ 应用层 Application       NestJS Modules：业务、权限、任务调度        │
│                              Passport JWT + RBAC PermissionsGuard     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│ AI 编排层 AI Orchestration  LangChain AgentExecutor / Tools          │
│                              LangGraph StateGraph（DAG 编译执行）    │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────┐
│ 基础设施层 Infrastructure PostgreSQL + Redis + Qdrant(+Milvus 占位)+ 文件存储 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、Monorepo 结构

```
agent-platform/
├── frontend/           # Vue 3 + Vite + JS + Element Plus + Pinia + @vue-flow/core
├── backend/            # NestJS 10 + TS（Modules / Controllers / Services）
├── docker/             # docker-compose、nginx、init.sql、env 示例
│   ├── docker-compose.yml
│   ├── .env / .env.example
│   ├── nginx/{nginx.conf, frontend-nginx.conf}
│   ├── postgres/init.sql
│   └── qdrant/config.yaml
├── PLAN.md             # ★ 本文档（项目根主维护）
└── README.md           # 项目总入口
```

**前后端通信**：Vue 前端通过 axios 调 NestJS `/api/*` 接口，Vite proxy 转发 `/api` 和 `/sse`（`vite.config.js` 已配置）。

---

## 三、技术栈详表

| 类别 | 选型 | 理由 |
|---|---|---|
| **前端框架** | Vue 3.5 + Vite 6 | 已有项目延续；Vite 启动快、HMR 好 |
| **前端语言** | **JavaScript**（**不引 TS**） | 用户明确要求保持 JS |
| **UI 组件** | Element Plus 2.x | 国内主流、文档齐；admin 后台标配 |
| **路由** | vue-router 4 | 已装 |
| **状态管理** | Pinia 2 | Vue 3 官方推荐；支持持久化 |
| **工作流可视化** | @vue-flow/core | Vue 3 生态最成熟的节点拖拽库 |
| **HTTP** | axios 1.x（升级） | 0.27 太老有 CVE；1.x API 兼容 |
| **Markdown** | marked + highlight.js + markdown-it | 已有 |
| **后端框架** | **NestJS 10 + TypeScript** | TS 企业级；模块化 + DI + 装饰器最适智能体/Tool 注册 |
| **数据库** | PostgreSQL 16 + **Prisma** | 关系型主流，Prisma TS 类型生成最完整 |
| **鉴权** | **@nestjs/passport + JWT + passport-jwt** | NestJS 生态标配；JWT 自签 |
| **密码哈希** | bcrypt | 标准选择；如遇 native 编译问题可换 bcryptjs |
| **任务队列** | BullMQ + Redis | 标准组合；NestJS 集成成熟（@nestjs/bullmq） |
| **LLM 框架** | LangChain.js + LangGraph.js | 用户指定 |
| **向量库** | Qdrant（默认） + Milvus（预留适配器） | 见下文方案 C |
| **LLM Provider** | OpenAI 兼容协议 | 一套代码覆盖 DeepSeek / Qwen / 智谱 / Ollama |
| **Docker** | Docker 24+ / Docker Compose v2 | 开发部署一体化 |

---

## 四、Backend 目录结构（NestJS Modules 风格）

```
backend/
├── prisma/
│   ├── schema.prisma             # 完整数据模型（用户/组织/权限/智能体/KB/...）
│   ├── migrations/
│   └── seed.ts                   # 默认 admin / 123456、默认角色、权限种子
├── src/
│   ├── main.ts                   # NestJS 入口（全局 prefix='/api' + ValidationPipe + CORS）
│   ├── app.module.ts             # 根 Module
│   ├── common/                   # 公共层
│   │   ├── decorators/
│   │   │   ├── public.decorator.ts
│   │   │   └── require-permission.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── permissions.guard.ts
│   │   └── filters/
│   │       └── http-exception.filter.ts
│   ├── database/
│   │   ├── prisma.service.ts
│   │   └── database.module.ts
│   ├── health/health.module.ts + health.controller.ts
│   ├── auth/                     # JWT 认证
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts    # POST /api/auth/login, /logout, /refresh
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   ├── local.strategy.ts
│   │   │   └── jwt.strategy.ts
│   │   └── dto/login.dto.ts
│   ├── users/                    # 用户管理
│   ├── organizations/            # 组织管理（树形）
│   ├── roles/                    # 角色管理
│   ├── permissions/              # 权限定义（只读枚举）
│   ├── rbac/                     # 角色-权限关联 + 数据范围过滤
│   ├── llm-providers/            # LLM Provider CRUD
│   ├── agents/                   # 智能体定义 CRUD
│   ├── chat-agent/               # 聊天智能体运行引擎（LangChain AgentExecutor）
│   ├── workflow-agent/           # 流程编排智能体（LangGraph StateGraph 编译）
│   ├── skills/                   # 自定义工具注册中心
│   ├── knowledge-bases/          # 知识库 CRUD
│   ├── documents/                # 文档上传 + 状态查询
│   ├── parsers/                  # 多格式文档解析（PDF/Word/Excel/PPT/Markdown/HTML/Image OCR）
│   ├── splitters/                # 文本切片
│   ├── embeddings/               # Embedding 模型管理
│   ├── vector-store/             # ★ 向量库适配层（见下文 6.4.1）
│   │   ├── adapter.ts
│   │   ├── qdrant/qdrant.adapter.ts
│   │   └── milvus/milvus.adapter.ts   # 占位 + TODO
│   ├── retrievers/               # 混合检索（向量 + BM25 + RRF + Rerank）
│   ├── conversations/            # 会话历史
│   ├── messages/                 # 消息持久化
│   ├── workflows/                # 工作流定义 + LangGraph 编译
│   ├── executions/               # 执行记录 / 链路追踪
│   ├── files/                    # 上传 / 下载
│   ├── api-keys/                 # 外部 API Key 管理
│   └── analytics/                # 监控日志
├── test/
├── Dockerfile                    # 多阶段：deps → build → runner
├── nest-cli.json
├── tsconfig.json + tsconfig.build.json
├── package.json
└── .env.example                  # DATABASE_URL / JWT_SECRET / QDRANT_URL / REDIS_URL / ...
```

**关键设计**：
- **认证**：passport-jwt 策略；从 Authorization header 提取 JWT；request.user 注入用户信息
- **权限**：`@RequirePermission('user:create')` 装饰器 + `PermissionsGuard` 反射读取
- **数据权限**：`RbacService.applyDataScope(userId)` 工具，在每个列表查询里手动调用（Prisma where 条件）
- **流式输出**：Controller 返回 `Observable` / `StreamableFile`，前端 EventSource / fetch + reader 消费

---

## 五、Frontend 目录结构

```
frontend/
├── public/
├── src/
│   ├── main.js                   # Pinia + Router + Element Plus 挂载
│   ├── App.vue
│   ├── api/                      # ★ axios 封装 + 业务模块 API
│   │   ├── client.js             # axios 实例 + token 拦截 + 401 处理
│   │   ├── auth.js
│   │   ├── users.js
│   │   ├── organizations.js
│   │   ├── roles.js
│   │   ├── permissions.js
│   │   ├── providers.js
│   │   ├── agents.js
│   │   ├── chat.js               # SSE 流式对话
│   │   ├── workflows.js
│   │   ├── knowledge-bases.js
│   │   └── files.js
│   ├── stores/                   # ★ Pinia
│   │   ├── user.js               # token + profile + roles + permissions
│   │   ├── permission.js
│   │   ├── workspace.js
│   │   ├── agent.js
│   │   ├── knowledgeBase.js
│   │   └── conversation.js
│   ├── composables/
│   │   ├── usePermission.js      # v-permission 指令 + 工具函数
│   │   ├── useChatStream.js      # SSE 流式订阅封装
│   │   ├── useWorkflowEditor.js
│   │   └── useKnowledgeRetrieval.js
│   ├── router/
│   │   ├── index.js
│   │   ├── routes.js
│   │   └── guards.js             # 鉴权 + 权限守卫
│   ├── layouts/
│   │   ├── MainLayout.vue        # 主后台布局（侧栏 + 头部 + RouterView）
│   │   ├── BlankLayout.vue       # 登录/错误页布局
│   │   ├── RouterView.vue        # Layout 复用组件
│   │   └── components/
│   │       ├── Sidebar.vue
│   │       └── TopBar.vue
│   ├── components/
│   │   ├── common/               # 通用组件（Loading/Empty/ErrorBoundary）
│   │   ├── rbac/
│   │   │   └── PermissionGuard.vue   # <PermissionGuard permission="user:create">
│   │   ├── agent/                # 智能体相关组件
│   │   ├── workflow/             # vue-flow 节点组件
│   │   ├── knowledge/            # 知识库组件
│   │   └── chat/                 # 继承自 VueViteApp 的聊天组件
│   │       ├── ChatWindow.vue
│   │       ├── MessageInput.vue
│   │       ├── MessageBubble.vue
│   │       ├── MarkdownRenderer.vue
│   │       ├── TypingEffect.vue
│   │       ├── FileUploader.vue
│   │       └── AudioUploader.vue
│   ├── views/
│   │   ├── auth/Login.vue
│   │   ├── errors/{Forbidden,NotFound,ServerError}.vue
│   │   ├── dashboard/Index.vue
│   │   ├── admin/
│   │   │   ├── users/UserList.vue + UserDetail.vue
│   │   │   ├── organizations/OrgTree.vue + OrgDetail.vue
│   │   │   ├── roles/RoleList.vue + RoleDetail.vue
│   │   │   └── api-keys/ApiKeyList.vue
│   │   ├── providers/ProviderList.vue
│   │   ├── agents/AgentList.vue + AgentEdit.vue + AgentDebug.vue
│   │   ├── workflows/WorkflowList.vue + WorkflowEditor.vue（@vue-flow/core）
│   │   ├── knowledge-bases/KBList.vue + KBDetail.vue
│   │   ├── conversations/ConversationList.vue + ConversationDetail.vue
│   │   ├── executions/ExecutionList.vue + ExecutionTrace.vue
│   │   ├── chat/Chat.vue
│   │   └── profile/Profile.vue
│   ├── utils/
│   │   ├── sse.js                # 继承自 VueViteApp
│   │   ├── storage.js
│   │   ├── format.js
│   │   └── constants.js
│   ├── assets/                   # 静态资源
│   └── styles/                   # 全局样式 + 主题变量
├── vite.config.js
├── jsconfig.json                 # 替代 tsconfig.json（项目用 JS）
├── package.json
├── Dockerfile
└── index.html
```

---

## 六、关键模块设计要点

### 1. LangGraph 工作流引擎（DAG → StateGraph 编译）

- **前端**：@vue-flow/core 拖拽编辑；节点类型 = LLM / Tool / Knowledge Retrieval / Condition / Code / HTTP / Answer
- **后端编译**：DAG JSON → LangGraph 的 `StateGraph`：
  - 每个节点映射到 LangGraph 节点函数（统一 `async (state) => Partial<state>`）
  - 条件分支用 `addConditionalEdges` 路由
  - 循环支持（max iterations 防死循环）
- **状态 Schema**：Zod / class-validator 定义 `GraphState`，包含 messages / artifacts / variables / current_step
- **执行**：StateGraph 编译成 `CompiledGraph`，`stream({ input })` 输出每步事件；SSE 推送

### 2. Skills 注册中心

- **注册方式**：用户上传 OpenAPI schema（自动生成 Tool）或自定义 JS 函数（Web Worker 沙箱）
- **LangChain Tool 抽象**：每个 Skill 实现 `DynamicTool(name, description, zodSchema, func)`
- **元数据**：name / description / parameters (zod) / return schema / required permissions
- **沙箱安全**：JS 函数 Tool 走独立 Worker + vm2 / isolated-vm；禁止 `require()`、限制执行时长 + 内存
- **调用追踪**：每次 Tool invoke 写 `tool_invocations` 表（参数/返回/耗时/Token）

### 3. 文档解析 + 切片

- **解析调度**：`parsers/index.ts` 按 MIME 路由：
  - PDF → `pdf-parse`（文字 PDF）或 `unstructured`（复杂排版扫描）
  - Word → `mammoth`
  - Excel → `xlsx`
  - PPT → `pptx`
  - Markdown → `remark` AST
  - HTML → `cheerio` / `unhtml`
  - 图片 → `tesseract.js`（OCR）；中文效果好可走云 API（百度/腾讯）
- **切片**：默认递归字符切片（`RecursiveCharacterTextSplitter`），保留段落语义；可选 Markdown-aware / Semantic（sentence-transformers 聚类）
- **后处理**：可选实体抽取（spaCy / HanLP）+ QA 对生成

### 4. 混合检索 + 向量库适配器（★ 方案 C 已落地）

#### 4.1 VectorStoreAdapter 抽象接口

后端抽象 `VectorStoreAdapter` 接口，**当前实现 Qdrant**，**预留 Milvus 适配器**位置。配置文件 `VECTOR_STORE=qdrant|milvus` 切换。

```typescript
// vector-store/adapter.ts
export interface VectorStoreAdapter {
  ensureCollection(name: string, dim: number, distance?: 'cosine' | 'euclid' | 'dot'): Promise<void>;
  upsert(collection: string, points: VectorPoint[]): Promise<void>;
  search(collection: string, query: number[], opts: SearchOptions): Promise<SearchResult[]>;
  delete(collection: string, filter: object): Promise<void>;
  scroll(collection: string, filter: object, limit?: number): Promise<Record[]>;
  payloadSearch(collection: string, filter: object, limit?: number): Promise<Record[]>;
  close(): Promise<void>;
}

// vector-store/index.ts
@Injectable()
export class VectorStoreService implements OnModuleInit {
  private adapter: VectorStoreAdapter;

  async onModuleInit() {
    const provider = this.config.get('VECTOR_STORE_PROVIDER', 'qdrant');
    if (provider === 'qdrant') {
      this.adapter = new QdrantAdapter(/* ... */);
    } else if (provider === 'milvus') {
      // 需要先实现 milvus.adapter.ts（~1 周）
      this.adapter = new MilvusAdapter(/* ... */);
    }
    throw new Error(`Unknown VECTOR_STORE_PROVIDER: ${provider}`);
  }
  // 委托所有方法到 this.adapter
}
```

**启用 Milvus 时额外配置**：
- `docker-compose.yml` 添加 `milvus` + `etcd` + `minio` 服务（standalone 模式）
- 实现 `vector-store/milvus/milvus.adapter.ts`
- 业务代码 **零改动**

#### 4.2 混合检索链路

```
Query → 规范化
     → 并行召回：
        ├─ Qdrant 向量召回（dense embedding + metadata filter）
        └─ PostgreSQL tsvector BM25 关键词召回（like pg_search plugin）
     → RRF 融合（避免不同评分尺度不可加）
     → Rerank（BGE-Reranker / Cohere / 国产 BGE）
     → TopK 返回
```

- **过滤维度**：organization / knowledgeBase / 文档标签 / 数据权限 / 时间范围
- **降级**：无结果时降级为关键词检索
- **可观测**：记录每阶段耗时、召回数、融合分数、命中文档

### 5. 聊天智能体的 SSE 流式输出

- **后端**：`@Sse()` 装饰器 + `Observable<MessageEvent>`；LangChain `agent.stream()` 转发到 SSE
- **前端**：`useChatStream` composable 封装 fetch + ReadableStream 解析；Token-by-token 渲染
- **持久化**：SSE 推送时同步写 `messages` 表；断线重连恢复最后 1 轮

---

## 七、用户/组织/角色/数据权限体系（★ RBAC 完整设计）

### 7.1 权限模型

```
用户 (users)
  ├─ 用户-组织 (user_organizations)         # 多组织归属 + 主组织
  ├─ 用户-角色 (user_roles)                # 多角色
  └─ 角色 (roles)
        ├─ 角色-权限 (role_permissions)    # 多对多
        └─ 权限 (permissions)              # 38 个内置权限码

数据范围（user_organizations.data_scope）：
  ALL / ORG_AND_CHILDREN / ORG / SELF / CUSTOM
```

### 7.2 内置角色（4 个）

| 角色 | 权限范围 | 数据范围 |
|---|---|---|
| `super_admin` | 全部 38 个权限 | ALL（全平台） |
| `admin` | 全部（除 `system:*`） | ORG_AND_CHILDREN（本组织及下级） |
| `editor` | 业务 CRUD，无 `system:*` 无 `*:delete` | ORG（本组织） |
| `viewer` | 仅 `*:read` | ORG |

### 7.3 38 个内置权限码

```
系统管理
  system:settings:read        system:settings:write
  system:audit:read           system:logs:read

用户/组织/角色
  user:create  user:read  user:update  user:delete  user:reset-password  user:assign-role
  org:create   org:read    org:update   org:delete   org:assign-member
  role:create  role:read   role:update  role:delete  role:assign-permission
  api-key:create  api-key:read  api-key:revoke

LLM Provider
  provider:create  provider:read  provider:update  provider:delete  provider:test

智能体
  agent:create  agent:read  agent:update  agent:delete  agent:debug  agent:publish

工作流
  workflow:create  workflow:read  workflow:update  workflow:delete  workflow:run

知识库
  kb:create  kb:read  kb:update  kb:delete
  document:upload  document:read  document:delete  document:retry-parse

会话/执行
  conversation:read  conversation:delete
  execution:read  execution:retry
```

### 7.4 默认账号 Seed

- **用户名**：`admin`  **密码**：`123456`
- **强制**：`mustChangePassword = true`（首登强制改密）
- **归属**：根组织 + super_admin + admin 双角色
- **实现**：`backend/prisma/seed.ts` 启动时自动写入（幂等）

### 7.5 三层权限拦截

| 层级 | 实现 | 作用 |
|---|---|---|
| **前端** | `<PermissionGuard permission="user:create">` + `v-permission` 指令 | UX 优化（隐藏按钮），**非安全屏障** |
| **后端 Guard** | `JwtAuthGuard`（全局）+ `PermissionsGuard`（路由级反射 `@RequirePermission`） | 路径级拦截 |
| **后端业务** | 每个 `*Service.findMany()` 内部调用 `applyDataScope(userId)` | 行级过滤 |

**铁律**：前端权限仅 UX；后端每个 controller 必须 `requirePermission`；每个列表查询必须 `applyDataScope`。

### 7.6 登录流程

```
用户输入 admin / 123456
  → 前端 POST /api/auth/login（明文，HTTPS 加密）
  → AuthController → AuthService.validate
  → prisma.user.findUnique({ username: 'admin' })
  → bcrypt.compare(password, user.passwordHash)
  → 校验通过：签 access JWT（15min）+ refresh JWT（7d）
  → 返回 { accessToken, refreshToken, user: { id, username, nickname, mustChangePassword }, roles, permissions }
  → 前端 Pinia userStore 存 accessToken（内存）+ refreshToken（localStorage）
  → axios 拦截器：每个请求 Authorization: Bearer <token>
  → 401：先尝试 refresh，失败才跳 /login
```

---

## 八、PostgreSQL Schema 概要（共 22+ 张表）

### 用户与权限（7 张）

| 表 | 关键字段 |
|---|---|
| `users` | id, username(unique), email(unique), nickname, avatar, passwordHash, status(active/disabled/locked), mustChangePassword, lastLoginAt |
| `organizations` | id, name, code, parentId(自引用树), path(materialized path), sort, status |
| `user_organizations` | id, userId, organizationId, isPrimary, dataScope(enum), customOrgIds(jsonb) |
| `roles` | id, code(super_admin/admin/editor/viewer), name, description, isBuiltIn, dataScope(default) |
| `permissions` | id, code(unique), resource, action, description |
| `role_permissions` | roleId, permissionId (联合主键) |
| `user_roles` | userId, roleId (联合主键) |

### 业务核心（15+ 张）

| 表 | 关键字段 |
|---|---|
| `llm_providers` | id, name, type(openai-compatible), baseUrl, apiKey(加密), defaultModel, organizationId |
| `embeddings_providers` | id, type(openai-compatible/cohere), baseUrl, apiKey(加密), dimensions |
| `agents` | id, name, type(CHAT/WORKFLOW), systemPrompt, modelParams, skillsRefs(jsonb), workflowId?, kbIds(jsonb), organizationId |
| `workflows` | id, name, version, graphJson(DAG), variables(jsonb), organizationId |
| `workflow_executions` | id, workflowId, status, inputJson, outputJson, startedAt, endedAt, tokenUsage |
| `execution_logs` | id, executionId, nodeId, status, input, output, durationMs |
| `skills` | id, name, type(OPENAPI/JS/HTTP), definition(jsonb), permissions |
| `tool_invocations` | id, executionId, skillId, inputJson, outputJson, durationMs, status |
| `knowledge_bases` | id, name, embeddingProviderId, vectorStoreConfig(jsonb), chunkingConfig(jsonb), organizationId |
| `documents` | id, kbId, name, mimeType, size, status(uploading/parsing/embedding/ready/failed), parserType, errorMsg |
| `document_chunks` | id, documentId, chunkIndex, content, metadata(jsonb), embeddingRef(vectorId) |
| `files` | id, name, mimeType, size, storagePath, uploaderId, organizationId |
| `conversations` | id, agentId, userId, title, status |
| `messages` | id, conversationId, role(user/assistant/tool/system), content, toolCalls(jsonb), tokenUsage, createdAt |
| `api_keys` | id, name, keyPrefix(显示用), keyHash, scopes(jsonb), lastUsedAt, expiresAt, organizationId |
| `refresh_tokens` | id, userId, tokenHash, expiresAt, revoked |
| `audit_logs` | id, userId, action, resource, resourceId, payload(jsonb), ip, userAgent, createdAt |

每张表通用字段：`id (cuid)`、`createdAt`、`updatedAt`、`deletedAt?(软删)`。

---

## 九、docker-compose 服务编排

| 服务 | 镜像 | 端口 | 卷挂载 | 健康检查 |
|---|---|---|---|---|
| **postgres** | `postgres:16-alpine` | 内网 `5432` | `postgres_data:/var/lib/postgresql/data` | `pg_isready` |
| **redis** | `redis:7-alpine` | 内网 `6379` | `redis_data:/data` | `redis-cli ping` |
| **qdrant** | `qdrant/qdrant:latest` | 内网 `6333/6334` | `qdrant_data:/qdrant/storage` | `GET /readyz` |
| **milvus** *(可选)* | `milvusdb/milvus:v2.4-standalone` | 内网 `19530` | `milvus_data:/var/lib/milvus` | `milvus health` |
| **etcd** *(milvus 依赖)* | `quay.io/coreos/etcd:v3.5.16` | 内网 `2379` | etcd_data | — |
| **minio** *(milvus 依赖)* | `minio/minio:latest` | 内网 `9000/9001` | minio_data | — |
| **backend** | 自建 `node:20-alpine` 多阶段（NestJS dist） | `3000:3000` | `uploads:/app/uploads` | `GET /api/health` |
| **frontend** | 自建 `nginx:alpine`（打包 dist） | `5173:80` | — | `wget http://localhost/` |
| **nginx** *(生产网关)* | `nginx:alpine` | `80/443` | `./nginx/nginx.conf` | `wget` |

**启动顺序**：postgres + redis + qdrant 先就绪，backend 等健康后启动 + 跑 `prisma migrate deploy` + `prisma db seed`，frontend 最后。

**安全原则**：PostgreSQL / Redis / Qdrant 不暴露公网，仅 Nginx 网关对外。`.env` 文件管理密钥（`JWT_SECRET`、`DATABASE_URL`、`QDRANT_URL`、`REDIS_URL`、`OPENAI_API_KEY` 等），`.env.example` 提交到仓库。

---

## 十、分阶段实施路线图

### Phase 1：基础设施 + 用户权限 + 聊天智能体 MVP（3 周）

**Week 1（已完成）**：
- [x] monorepo 目录 + frontend 迁移
- [x] NestJS 10 + Prisma + Docker Compose（postgres/redis/qdrant/nginx）
- [x] Prisma schema（22+ 表）+ seed（admin/123456 + 4 角色 + 38 权限）
- [x] NestJS auth（Passport JWT + bcrypt）
- [x] 后端 RBAC（PermissionsGuard + @RequirePermission + 数据范围）
- [x] 前端登录 + 路由守卫 + Pinia user/permission store + <PermissionGuard>

**Week 2（已完成）**：
- [x] LLM Provider 模块：CRUD + API Key 加密（AES-256-GCM）+ OpenAI 兼容 Adapter 工厂
- [x] 聊天智能体：ChatEngine（LangChain ChatModel + SSE 流式）+ `/api/agents/:id/chat`
- [x] 前端 Provider / Agent 列表页 + Agent Debug 流式对话页
- [x] `useChatStream` composable

**Week 3（已完成）**：
- [x] 端到端验证：admin/123456 登录 → /api/llm-providers → /api/agents → /api/chat（SSE 多轮）全通
- [x] 补全「智能对话」页（`Chat.vue` 从占位改为真实流式多会话，后端新增 `/api/chat` 用默认 Provider 直接聊）
- [x] 修复残留 bug：左侧菜单（App.vue layout 判断）、用户管理（api 聚合 + DTO 字段）、聊天读-写顺序、MiniMax 端点（com vs chat）
- [x] UI 自适应优化：1080p / 2K / 4K CSS 变量 + 媒体查询断点；聊天气泡限宽 + `<think>` 折叠
- [x] README（根目录）+ 部署文档（docker/README.md）

### Phase 2：LangGraph 工作流智能体 + 通用对话存库（3 周）

**核心**：LangGraph 工作流引擎 + vue-flow 可视化编辑器

**任务清单**：
- [ ] 后端：`workflow` 模块——LangGraph `StateGraph` 封装 + DAG 编译（前端 vue-flow JSON → CompiledGraph）
- [ ] 后端：节点库先做 3 个核心——LLM（复用 ChatEngine）/ Tool（基础工具调用）/ KB（占位接口，Phase 3 充实）
- [ ] 后端：节点库扩展——Condition / Code / HTTP / Answer（按需）
- [ ] 后端：Prisma 新增 4 张表——`Workflow / WorkflowVersion / WorkflowRun / NodeExecution`
- [ ] 后端：状态 Schema（class-validator）——`GraphState = { messages, artifacts, variables, current_step }`
- [ ] 后端：执行 SSE 接口——`POST /api/workflows/:id/runs` 输出每步事件
- [ ] 后端：**通用对话存库（Phase 1 Week 3 遗漏的 P0）**——`/api/chat` 复用已有 Conversation/Message 表，模仿 `AgentsService.chat()` 模式做"先存 user → 加载历史 → 流式 → stream.on('end') 存 assistant"；新增 `listConversations / getConversationMessages / deleteConversation`
- [ ] 后端：工作流 CRUD + 版本管理接口
- [ ] 前端：装 `@vue-flow/core` + `@vue-flow/controls` + `@vue-flow/background`
- [ ] 前端：`views/workflow/WorkflowList.vue`（列表 + 创建 + 版本切换）
- [ ] 前端：`views/workflow/WorkflowEditor.vue`（核心：拖拽节点 + 连线 + 节点配置抽屉 + 保存版本）
- [ ] 前端：`views/workflow/WorkflowDebug.vue`（输入测试 + SSE 看每节点实时输出）
- [ ] 前端：**通用对话会话列表接入**——`Chat.vue` 把本地 mock 会话列表替换为接口数据 + 切换会话加载历史
- [ ] 前端：节点组件——LLMNode / ToolNode / KbNode / ConditionNode / AnswerNode
- [ ] 端到端验证：创建 DAG → 配置节点 → 运行 → 查看每节点输入/输出

**风险**：
- LangGraph.js vs Python 版能力差距 → PoC 关键能力验证后再全面展开
- 工作流可视化编辑器工程量大 → 按节点库分批交付，先做 LLM 节点

### Phase 3：知识库 + 文档解析（2 周）
- 字符/段落/语义切片 + Embedding + Qdrant 向量化
- 多格式文档解析（PDF/Word/Excel/PPT/Markdown/HTML/Image OCR）
- 混合检索 + Rerank

### Phase 4：自定义 Skills 工具市场（1 周）
- Tool 注册中心 + OpenAPI → Tool 自动生成
- 沙箱执行（VM2 / isolated-vm）
- 调用追踪 + 配额

### Phase 5：完善与优化（2 周）
- 用户/权限高级特性（角色继承 / 字段级权限）
- 监控：Prometheus metrics + Grafana 仪表盘 + 链路追踪
- 暴露 Agent/Workflow 的外部 REST API + API Key 管理
- 性能优化：embedding 缓存、检索结果去重、流式断线重连

---

## 十一、关键风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| 1 | **LangGraph.js vs Python 版能力差距** | 抽象 `GraphRuntime` 接口，锁定版本 + PoC 关键能力；不可用时切换独立 Python 编排服务，NestJS 继续作统一业务网关 |
| 2 | **文档解析质量差**（PDF 复杂排版/扫描件） | 简单文字 PDF 用 pdf-parse，复杂版式走 `unstructured.io`，扫描件 OCR 走 Tesseract / 云 API；提供"重新解析"按钮 |
| 3 | **工作流可视化编辑器工程量大** | 直接用 `@vue-flow/core`（已集成）；节点库先做 3 个核心（LLM/Tool/KB），其他节点按需扩展 |
| 4 | **向量库性能与检索效果调优** | Qdrant 按 organization/KB 设计 collection 策略，批量异步写入；记录召回率/延迟/TopK/Rerank 耗时；离线评测集持续调参；Milvus 适配器预留扩展 |
| 5 | **多 LLM Provider 适配成本** | 统一 OpenAI 兼容协议；各家 SDK 协议差异小（DeepSeek/Qwen/智谱都是 OpenAI 兼容） |
| 6 | **前后端权限不一致导致越权** | 后端每个 Controller 必须调用 `requirePermission`；查列表必须 `applyDataScope`；前端权限只是 UX；CI 增加权限矩阵测试覆盖 |
| 7 | **默认弱密码 + 默认账号泄露风险** | 首次登录强制改密；`JWT_SECRET` 强制 32+ 字符；部署文档警告修改默认密码；登录失败限速 + 锁定 |
| 8 | **NestJS 不适合重 CPU 任务** | 文档解析/Embedding 走 BullMQ Worker，不在 Controller 内同步执行；NestJS 仅作编排入口 |

---

## 十二、立即可执行的下一步（Phase 2：LangGraph 工作流智能体）

1. 后端 `workflow` 模块：LangGraph `StateGraph` 封装 + DAG 编译（前端 vue-flow JSON → StateGraph）
2. 节点库（先做 3 个核心）：`LLM` / `Tool` / `KB`，其余按需扩展（Condition / Code / HTTP / Answer）
3. 前端 `views/workflow/`：基于 `@vue-flow/core` 的可视化编辑器（拖拽节点 + 连线 + 节点配置面板）
4. 工作流执行 / 调试 / 版本管理接口
5. 端到端验证：创建 DAG → 配置节点 → 运行 → 查看各节点输入/输出

---

## 十三、变更记录

| 日期 | 变更 |
|---|---|
| 2026-07-22 | 初版方案：从 NestJS 起步（中间被改为 NextJS 一次，已纠正）|
| 2026-07-22 | 调整为：NestJS + Vue 3 JS（不引 TS）+ 完整 RBAC + admin/123456 默认账号 |
| 2026-07-22 | **方案 C**：Qdrant 默认 + Milvus 预留适配器位置 |
| 2026-07-22 | Phase 1 Week 1 完成：monorepo + NestJS + Prisma + seed + Docker + 登录闭环 |
| 2026-07-23 | **Phase 1 全部完成**：Week 2（LLM Provider + 聊天智能体 + 前端 3 页 + useChatStream）+ Week 3（端到端验证 + 智能对话页补全 + UI 自适应 1080p/2K/4K + README）|
| 2026-07-23 | 新增 `/api/chat` 通用对话端点（用默认 Provider 直接聊，SSE 流式），前端 `Chat.vue` 从占位改为真实多会话流式对话 |
