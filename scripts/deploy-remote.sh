#!/usr/bin/env bash
# ============================================================
# agent-platform 远程部署脚本（生产机本地跑）
# 配套 deploy-prod.sh 使用；本身也可在生产机直接执行。
#
# 用法:
#   ./deploy-remote.sh deploy
#   ./deploy-remote.sh rollback [snap-id]
#   ./deploy-remote.sh list-snapshots
#
# 特性:
#   - 部署前自动 snapshot（.env.prod + 当前镜像打 backup tag）
#   - 健康检查失败 → 自动回滚到本次 snapshot
#   - 历史 snapshot 保留在 docker/.snapshots/<timestamp>/
# ============================================================
set -euo pipefail

# ========== 颜色 ==========
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️ $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}" >&2; }

# ========== 路径常量 ==========
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/../docker" && pwd)"
SNAPSHOT_DIR="$DOCKER_DIR/.snapshots"
mkdir -p "$SNAPSHOT_DIR"
ENV_FILE="$DOCKER_DIR/.env.prod"

# ========== Snapshot 工具 ==========

# take_snapshot: 备份当前 .env.prod + 给运行中镜像打 backup tag
# 输出: snapshot id (timestamp) 到 stdout
take_snapshot() {
  local ts; ts=$(date +%Y%m%d-%H%M%S)
  local snap_dir="$SNAPSHOT_DIR/$ts"
  mkdir -p "$snap_dir"

  log "📦 创建快照: $ts"

  # 1. 备份 .env.prod
  if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$snap_dir/.env.prod"
  fi

  # 2. 给 backend/frontend 镜像打 backup tag
  for svc in backend frontend; do
    local cid image image_name
    cid=$(docker compose --env-file "$ENV_FILE" ps -q "$svc" 2>/dev/null || true)
    [ -z "$cid" ] && continue

    image=$(docker inspect --format='{{.Config.Image}}' "$cid" 2>/dev/null || true)
    [ -z "$image" ] && continue

    image_name="${image%:*}"  # 去掉 tag，留 repo 名
    if docker tag "$cid" "${image_name}:backup-$ts" 2>/dev/null; then
      echo "${svc}:${image_name}:backup-$ts" >> "$snap_dir/backup-tags.txt"
    else
      warn "无法打 backup tag: $image"
    fi
  done

  # 3. 写时间戳
  echo "$ts" > "$snap_dir/timestamp"
  echo "$ts"  # 输出给调用者
}

# rollback_to <snap_id>: 恢复 .env.prod + 用 backup tag 重打 latest + 重启 + 健康检查
rollback_to() {
  local snap_id="$1"
  local snap_dir="$SNAPSHOT_DIR/$snap_id"

  if [ ! -d "$snap_dir" ]; then
    err "快照不存在: $snap_id"
    return 1
  fi

  log "⏪ 回滚到快照: $snap_id"

  # 1. 恢复 .env.prod
  if [ -f "$snap_dir/.env.prod" ]; then
    cp "$snap_dir/.env.prod" "$ENV_FILE"
    ok ".env.prod 已恢复"
  else
    warn "快照里没有 .env.prod，跳过恢复"
  fi

  # 2. 用 backup tag 恢复 latest
  if [ -f "$snap_dir/backup-tags.txt" ]; then
    while IFS=':' read -r svc image_name rest; do
      [ -z "$svc" ] && continue
      # 格式: svc:repo:backup-ts  =>  repo:backup-ts
      local backup_tag="${image_name}:${rest}"
      local repo_latest="${image_name}:latest"
      if docker tag "$backup_tag" "$repo_latest" 2>/dev/null; then
        log "  ↻ 恢复镜像: $repo_latest ← $backup_tag"
      else
        warn "  ⚠️ tag 失败: $backup_tag"
      fi
    done < "$snap_dir/backup-tags.txt"
  else
    warn "快照里没有 backup-tags.txt，跳过镜像恢复"
  fi

  # 3. 重启容器
  cd "$DOCKER_DIR"
  docker compose --env-file "$ENV_FILE" up -d

  # 4. 健康检查
  if wait_healthy; then
    ok "回滚成功 ✅"
    return 0
  else
    err "回滚后容器仍不健康，请人工介入"
    return 1
  fi
}

# wait_healthy: 轮询 backend 容器 health 状态
wait_healthy() {
  local max=30 i status
  log "等待后端 healthy（最多 ${max}x2s）..."
  for i in $(seq 1 "$max"); do
    status=$(docker inspect agent-platform-backend --format='{{.State.Health.Status}}' 2>/dev/null || echo "starting")
    if [ "$status" = "healthy" ]; then
      ok "后端 healthy"
      return 0
    fi
    sleep 2
  done
  err "后端未在 ${max}x2s 内达到 healthy"
  return 1
}

# ========== 部署主流程 ==========

do_deploy() {
  log "=== 🚀 开始生产部署 ==="
  cd "$DOCKER_DIR"

  # 前置检查
  command -v docker >/dev/null || { err "docker 未安装"; exit 1; }
  docker compose version >/dev/null 2>&1 || { err "docker compose v2 未安装"; exit 1; }

  # 创建快照（部署前状态，用于失败回滚）
  local snap_id
  snap_id=$(take_snapshot)

  # 生成 / 校验 .env.prod
  if [ ! -f "$ENV_FILE" ]; then
    warn ".env.prod 不存在，自动生成"
    cp "$DOCKER_DIR/.env.example" "$ENV_FILE"
    sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" "$ENV_FILE"
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 48)|" "$ENV_FILE"
    sed -i "s|^DEFAULT_ADMIN_PASSWORD=.*|DEFAULT_ADMIN_PASSWORD=$(openssl rand -base64 18)|" "$ENV_FILE"
    sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" "$ENV_FILE"

    warn "⚠️ 关键决策点 ⚠️"
    echo "  - 如果是首次部署：新生成的 ENCRYPTION_KEY 可用"
    echo "  - 如果从旧库迁移：必须改回旧 ENCRYPTION_KEY（否则历史 api_keys 解密失败）"
    echo "当前生成的 ENCRYPTION_KEY:"
    grep '^ENCRYPTION_KEY=' "$ENV_FILE"
    echo ""
    read -rp "确认继续？(yes/no): " confirm
    [ "$confirm" = "yes" ] || { err "用户中止"; exit 1; }
  fi

  # nginx 证书检查
  if [ ! -f "$DOCKER_DIR/nginx/certs/fullchain.pem" ]; then
    warn "nginx/certs/fullchain.pem 不存在，HTTPS 将使用自签证书（浏览器会警告）"
    read -rp "继续部署？(yes/no): " confirm
    [ "$confirm" = "yes" ] || { err "用户中止"; exit 1; }
  fi

  # 构建
  log "🔨 构建镜像..."
  if ! docker compose --env-file "$ENV_FILE" build; then
    err "构建失败，触发回滚"
    rollback_to "$snap_id" || { err "回滚也失败"; exit 2; }
    exit 1
  fi

  # 启动
  log "🚀 启动服务..."
  docker compose --env-file "$ENV_FILE" up -d

  # 健康检查（失败自动回滚）
  if ! wait_healthy; then
    err "健康检查失败，触发自动回滚..."
    rollback_to "$snap_id" || { err "回滚也失败，请人工介入"; exit 2; }
    exit 1
  fi

  ok "🎉 部署完成"

  # 输出运维信息
  local ip
  ip=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "<server-ip>")
  cat <<EOF

📋 部署结果:
   访问 URL:       http://$ip  (或 http://localhost)
   默认管理员:     admin
   默认密码:       $(grep '^DEFAULT_ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2)
   快照 ID:        $snap_id
   回滚命令:       bash scripts/deploy-remote.sh rollback $snap_id

📦 数据卷:$(docker volume ls --format '     - {{.Name}}' | grep -E 'postgres|qdrant|uploads|redis' || echo '     (使用 bind mount，无 named volume)')

⚠️ 首次登录后立即修改 admin 密码！

💾 备份 uploads 数据卷:
   docker run --rm -v docker_backend_uploads:/d -v \$(pwd):/b busybox \\
     tar czf /b/uploads-\$(date +%Y%m%d).tar.gz /d
EOF
}

# ========== 快照列表 ==========

list_snapshots() {
  log "=== 📦 历史快照 ==="
  if [ ! -d "$SNAPSHOT_DIR" ] || [ -z "$(ls -A "$SNAPSHOT_DIR" 2>/dev/null)" ]; then
    warn "没有快照"
    exit 0
  fi
  local i=0
  for d in $(ls -1t "$SNAPSHOT_DIR"); do
    i=$((i+1))
    echo "  [$i] 📦 $d"
    if [ -f "$SNAPSHOT_DIR/$d/.env.prod" ]; then
      echo "      .env.prod ✅"
    fi
    if [ -f "$SNAPSHOT_DIR/$d/backup-tags.txt" ]; then
      sed 's/^/        /' "$SNAPSHOT_DIR/$d/backup-tags.txt"
    fi
  done
}

# ========== 入口 ==========

case "${1:-}" in
  deploy)
    do_deploy
    ;;
  rollback)
    if [ -n "${2:-}" ]; then
      rollback_to "$2"
    else
      latest=$(ls -1t "$SNAPSHOT_DIR" 2>/dev/null | head -1)
      if [ -z "$latest" ]; then
        err "没有可用快照"
        exit 1
      fi
      warn "回滚到最近的快照: $latest"
      rollback_to "$latest"
    fi
    ;;
  list-snapshots|ls)
    list_snapshots
    ;;
  *)
    cat <<EOF
用法: $0 <command> [args]

命令:
  deploy                部署 + 自动健康检查 + 失败回滚
  rollback [snap-id]    回滚（默认回滚到最近一次快照）
  list-snapshots        列出所有历史快照

示例:
  $0 deploy
  $0 rollback 20260828-170000
  $0 list-snapshots
EOF
    exit 1
    ;;
esac