# AI Agent Platform - Docker 部署

## 快速启动

```bash
# 1. 复制环境变量模板（首次）
cp docker/.env.example docker/.env

# 2. 修改 JWT_SECRET 和密码
#    生成随机 JWT_SECRET：
#    node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# 3. 启动所有服务
cd docker
docker compose up -d

# 4. 查看日志
docker compose logs -f backend

# 5. 访问
#    前端：http://localhost
#    后端 API：http://localhost/api/health
#    默认账号：admin / 123456
```

## 服务列表

| 服务 | 端口（仅 80/443 对外） | 说明 |
|---|---|---|
| nginx | 80, 443 | 网关，反向代理 + TLS |
| frontend | 80（内） | Vue3 静态资源 |
| backend | 3000（内） | NestJS API |
| postgres | 5432（内） | 数据库 |
| redis | 6379（内） | 缓存 / BullMQ |
| qdrant | 6333, 6334（内） | 向量库（默认） |

## 切换 Milvus

修改 `docker-compose.yml`，注释 qdrant 服务，取消 Milvus 服务注释。
同时修改 `backend/.env`：`VECTOR_STORE_PROVIDER=milvus`、`MILVUS_ADDRESS=milvus:19530`。

> 注意：Milvus 适配器需要单独实现 `backend/src/vector-store/milvus/milvus.adapter.ts`，
> Phase 1 默认只实现 Qdrant 适配器。

## 数据持久化

通过 named volumes 持久化：
- `postgres_data` —— 数据库
- `redis_data` —— 缓存
- `qdrant_data` —— 向量库
- `backend_uploads` —— 上传文件

## 备份 / 恢复

```bash
# 备份数据库
docker compose exec postgres pg_dump -U postgres agent_platform > backup.sql

# 恢复
cat backup.sql | docker compose exec -T postgres psql -U postgres agent_platform
```