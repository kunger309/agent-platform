# AI Agent 开发平台

> 基于 **NestJS + Vue 3 + LangChain.js + Qdrant** 构建的 AI 智能体开发平台（Phase 1 MVP）

一个企业级 AI 智能体开发平台的起步骨架：完整的 RBAC 权限体系 + 可配置的 LLM Provider + 流式聊天智能体 + 通用对话。后续可扩展 LangGraph 工作流、知识库、Skills 市场。

---

## 一、技术栈

### 后端
- **NestJS 10**（Node 20 + TypeScript）
- **Prisma 5** + **PostgreSQL 16**
- **Redis 7**（缓存 / BullMQ 队列，Phase 2+ 使用）
- **LangChain.js 1.x**（基于 `@langchain/openai` 的 OpenAI 兼容适配器，统一接入 DeepSeek / Qwen / 智谱 / MiniMax / Ollama）
- 认证：**Passport JWT** + **bcrypt**
- 权限：**RBAC**（用户 / 组织 / 角色 / 数据权限，三层拦截）

### 前端
- **Vue 3** + **Vite 6**（纯 JS，不引 TS）
- **Element Plus** + **Pinia** + **Vue Router 4**
- **@vue-flow/core**（Phase 2 工作流可视化编辑器预留）
- **marked / markdown-it / highlight.js**（Markdown 渲染预留）

---

## 二、当前进度

✅ **Phase 1：基础设施 + 用户权限 + 聊天智能体 MVP（已完成）**
- **Week 1**：monorepo 目录 + NestJS + Prisma + Docker Compose + seed（admin/123456 + 4 角色 + 38 权限）+ 登录闭环
- **Week 2**：LLM Provider 模块（CRUD + API Key 加密 + OpenAI 兼容 Adapter）+ 聊天智能体（SSE 流式）+ 前端 Provider / Agent / Debug 页 + `useChatStream`
- **Week 3**：端到端验证 + 智能对话页补全 + 本文档

⬜ **Phase 2**：LangGraph 工作流智能体（DAG 编译 + vue-flow 编辑器 + 节点库）
⬜ **Phase 3**：知识库 + 文档解析（切片 / Embedding / Qdrant / 混合检索）
⬜ **Phase 4**：自定义 Skills 工具市场（OpenAPI → Tool / 沙箱执行）
⬜ **Phase 5**：完善与优化（权限高级特性 / 监控 / 外部 API / 性能）

详细架构与分阶段路线图见 [docs/PLAN.md](docs/PLAN.md)。

---

## 三、目录结构

```
agent-platform/
├── backend/                 # NestJS 后端
│   └── src/
│       ├── auth/            # 登录 / JWT / 权限守卫
│       ├── users/           # 用户管理
│       ├── rbac/            # 角色 / 权限 / 数据范围
│       ├── llm/             # LLM Provider + ChatEngine + /api/chat
│       ├── agents/          # 聊天智能体 + SSE 对话
│       ├── common/          # 加密服务 / 守卫 / 装饰器
│       └── prisma/          # schema + seed
├── frontend/                # Vue 3 前端
│   └── src/
│       ├── views/           # 页面（dashboard / agents / providers / chat / admin）
│       ├── layouts/         # 主框架（侧栏 + 顶栏）
│       ├── stores/          # Pinia（user / permission）
│       ├── api/             # 接口封装
│       └── composables/     # useChatStream 等
└── docker/                  # docker-compose + nginx + 初始化脚本
```

---

## 四、快速开始

### 方式 A：本地开发（推荐调试）

前置：Node 20+、Docker Desktop（用于起 postgres / redis / qdrant 容器）

```bash
# 1. 启动基础设施（Windows 本机已有 5432/6379 系统服务，容器用高位端口规避冲突）
cd docker && docker compose up -d postgres redis qdrant

# 2. 后端
cd backend
npm install
npx prisma generate
npx prisma db push          # 首次建表（已 push 可跳过）
npm run start:dev           # http://localhost:3000

# 3. 前端（另开一个终端）
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

浏览器访问 http://localhost:5173 ，用 `admin / 123456` 登录。

### 方式 B：Docker 一键（生产 / 演示）

```bash
cd docker
cp .env.example .env        # 修改 JWT_SECRET 与默认密码
docker compose up -d
# 访问 http://localhost （nginx 网关）
```

详见 [docker/README.md](docker/README.md)。

---

## 五、环境变量（backend/.env）

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgresql://postgres:postgres123@localhost:55432/agent_platform` |
| `REDIS_HOST` / `REDIS_PORT` | Redis 地址 | `localhost` / `6380` |
| `QDRANT_URL` | 向量库地址 | `http://localhost:6334` |
| `JWT_SECRET` | JWT 签名（**生产环境必须改**） | 占位串 |
| `ENCRYPTION_KEY` | Provider API Key 加密（AES-256-GCM，32 字节 hex） | — |
| `DEFAULT_ADMIN_USERNAME` / `DEFAULT_ADMIN_PASSWORD` | seed 默认账号 | `admin` / `123456` |

> ⚠️ `backend/.env` 已加入 `.gitignore`，**切勿将密钥提交到 git**。

---

## 六、配置 LLM Provider（首次使用必做）

平台本身不内置任何 LLM Key，必须先配置一个 Provider 才能聊天：

1. 登录后进入 **模型配置** 页
2. 点 **添加 Provider**
   - 类型：MiniMax（或 DeepSeek / Qwen / OpenAI / Ollama）
   - 端点地址：
     - MiniMax **国际版**：`https://api.minimaxi.com/v1`（`sk-cp-` 开头 key）
     - MiniMax **国内版**：`https://api.minimaxi.chat/v1`（另一套 key）
   - 模型：`MiniMax-M3`（或对应模型名）
   - API Key：填写你自己的
3. 设为默认 → 点 **测试** 确认连通
4. 进入 **智能体** → 新建（选择该 Provider）→ 调试对话；或直接进 **智能对话** 页开聊

---

## 七、默认账号

| 用户名 | 密码 | 角色 |
|---|---|---|
| `admin` | `123456` | 超级管理员（super_admin，拥有全部权限） |

> 建议首次登录后修改密码（Phase 5 会强制首登改密）。

---

## 八、端到端验证（Phase 1 已验证通过）

| 步骤 | 接口 | 状态 |
|---|---|---|
| 登录 | `POST /api/auth/login` | ✅ |
| 列出 Provider | `GET /api/llm-providers` | ✅ |
| 列出智能体 | `GET /api/agents` | ✅ |
| 通用对话（SSE 流式 + 多轮） | `POST /api/chat` | ✅ |
| 智能体对话（SSE 流式） | `POST /api/agents/:id/chat` | ✅ |

---

## 九、已知限制 / 注意事项

- **Windows 端口冲突**：本机已有 `postgres:5432` / `redis:6379` 系统服务，容器改用高位端口 `55432 / 6380 / 6334`；`backend/.env` 的 `DATABASE_URL` 已对应高位端口。生产 Docker 走 80 网关，端口在容器网络内部。
- **对话落库策略**：「智能对话」页的会话是**前端内存维护**（刷新即丢失），不写入 `Conversation` 表；「智能体调试」页的对话会落库。
- **MiniMax 端点易错**：国际版 `minimaxi.com` vs 国内版 `minimaxi.chat`，key 格式不同，配错会 401。
- **API Key 加密**：数据库只存加密后的 Key，列表接口仅回显末尾 4 位。
- **`<think>` 标签**：MiniMax-M3 是推理模型，输出含 `<think>...</think>`，前端已折叠为「思考过程」可展开块。

---

## 十、后续路线图

| 阶段 | 内容 |
|---|---|
| **Phase 2** | LangGraph 工作流智能体：DAG 编译 + vue-flow 可视化编辑器 + 节点库（LLM / Tool / KB / Condition / Code / HTTP / Answer）+ 执行/调试/版本管理 |
| **Phase 3** | 知识库 + 文档解析：字符/段落/语义切片 + Embedding + Qdrant 向量化 + 混合检索 + Rerank |
| **Phase 4** | 自定义 Skills 工具市场：Tool 注册中心 + OpenAPI → Tool 自动生成 + 沙箱执行 |
| **Phase 5** | 用户/权限高级特性（角色继承 / 字段级权限）+ 监控（Prometheus / Grafana / 链路追踪）+ 外部 REST API + 性能优化 |

详细设计见 [docs/PLAN.md](docs/PLAN.md)。
