-- AI Agent Platform - PostgreSQL init
-- 首次启动时执行（如果数据库已存在则不会执行）

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- 用于全文检索加速

-- 字符集
ALTER DATABASE agent_platform SET timezone TO 'UTC';