#!/usr/bin/env bash
# ============================================================
# agent-platform dev 一键启动(精简版)
# 等价手动 3 行:
#   cd docker    && docker compose up -d postgres redis qdrant
#   cd backend   && npm run start:dev
#   cd frontend  && npm run dev
# 唯一区别:脚本用 & 把后端/前端放后台,一个窗口代替三个。
# ============================================================
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

(cd "$SCRIPT_DIR/docker"    && docker compose up -d postgres redis qdrant)
(cd "$SCRIPT_DIR/backend"   && nohup npm run start:dev > dev.log 2>&1 &)
(cd "$SCRIPT_DIR/frontend"  && nohup npm run dev         > dev.log 2>&1 &)

echo "✓ 前端 http://localhost:5173  日志: frontend/dev.log"
echo "✓ 后端 http://localhost:3000  日志: backend/dev.log"
echo "✓ 中间件状态: docker compose -f docker/docker-compose.yml ps"
echo "✓ 停止: taskkill /F /IM node.exe  (Windows)  或  pkill -f 'nest start'; pkill -f vite  (Git Bash)"
