# ============================================================
# Backend Dockerfile（NestJS）
# 多阶段构建：deps → build → runner
# ============================================================

# ===== Stage 1: 依赖 =====
FROM node:20-alpine AS deps
WORKDIR /app

# 兼容 bcrypt 在 alpine 上需要的原生依赖
RUN apk add --no-cache python3 make g++ libc6-compat

COPY backend/package*.json ./
COPY backend/prisma ./prisma/

# 仅安装 production 依赖（prisma generate 需要完整类型）
RUN npm ci --include=dev

# 生成 Prisma Client
RUN npx prisma generate

# ===== Stage 2: 构建 =====
FROM node:20-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./

RUN npm run build && npm prune --production

# ===== Stage 3: Runner =====
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# 复制构建产物 + 必要文件
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nestjs:nodejs /app/package.json ./package.json

# 上传目录
RUN mkdir -p /app/uploads && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 3000

# 启动时执行：migrate + seed → 启动服务
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]