# ============================================================
# Frontend Dockerfile（Vue 3 + Vite）
# 多阶段构建：builder → nginx runner
# ============================================================

# ===== Stage 1: 构建 =====
FROM node:20-alpine AS builder
WORKDIR /app

# 国内网络优化：npm 走 npmmirror 源
RUN npm config set registry https://registry.npmmirror.com

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ===== Stage 2: Nginx 运行 =====
FROM nginx:alpine AS runner

# 复制自定义 nginx 配置
COPY docker/nginx/frontend-nginx.conf /etc/nginx/conf.d/default.conf

# 复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]