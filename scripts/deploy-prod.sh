#!/usr/bin/env bash
# ============================================================
# agent-platform 远程部署编排（开发机 / 控制机跑）
# 通过 SSH 把代码同步到生产机，并触发 deploy-remote.sh。
#
# 用法:
#   ./deploy-prod.sh --host user@server
#   ./deploy-prod.sh --host user@server --rollback
#   ./deploy-prod.sh --host user@server --list
#   ./deploy-prod.sh --host user@server --sync-mode rsync
#
# ⚠️ Windows Git Bash 可直接运行（用 OpenSSH 自带的 rsync，
#    如未安装会自动回退到 scp 模式）。
# ============================================================
set -euo pipefail

# ========== 颜色 ==========
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️ $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}" >&2; }

usage() {
  cat <<EOF
用法: $0 --host <user@server> [options]

必选:
  --host HOST              目标主机 SSH 连接串 (e.g. root@192.168.1.10)

可选:
  --ssh-key PATH           SSH 私钥 (默认 ~/.ssh/id_rsa)
  --ssh-port PORT          SSH 端口 (默认 22)
  --path PATH              远程项目路径 (默认 /opt/agent-platform)
  --sync-mode MODE         代码同步: git | rsync | skip (默认 git)
  --rollback               回滚到最近一次成功的快照
  --list                   列出远程历史快照
  --dry-run                只打印命令，不执行
  -h | --help              显示本帮助

sync-mode 说明:
  git     远程跑 'git pull'，假设本地已 git push
  rsync   本地 rsync 推送整个项目（自动排除 node_modules / uploads）
  skip    假设代码已手动同步，只跑部署脚本

典型流程:
  1. 本地: git push
  2. 本地: ./scripts/deploy-prod.sh --host root@prod-server
  3. 部署失败: ./scripts/deploy-prod.sh --host root@prod-server --rollback
EOF
}

# ========== 参数解析 ==========
HOST=""
SSH_KEY=""
SSH_PORT="22"
REMOTE_PATH="/opt/agent-platform"
SYNC_MODE="git"
CMD="deploy"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       HOST="$2"; shift 2;;
    --ssh-key)    SSH_KEY="$2"; shift 2;;
    --ssh-port)   SSH_PORT="$2"; shift 2;;
    --path)       REMOTE_PATH="$2"; shift 2;;
    --sync-mode)  SYNC_MODE="$2"; shift 2;;
    --rollback)   CMD="rollback"; shift;;
    --list)       CMD="list-snapshots"; shift;;
    --dry-run)    DRY_RUN=1; shift;;
    -h|--help)    usage; exit 0;;
    *)            err "未知参数: $1"; usage; exit 1;;
  esac
done

[ -z "$HOST" ] && { err "必须指定 --host"; usage; exit 1; }

# ========== SSH 选项构造 ==========
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi

# run_ssh <remote_cmd...>: 跑 SSH 命令（dry-run 时只打印）
run_ssh() {
  if [ $DRY_RUN -eq 1 ]; then
    echo "[DRY-RUN] ssh ${SSH_OPTS[*]} $HOST -- $*"
  else
    ssh "${SSH_OPTS[@]}" "$HOST" -- "$@"
  fi
}

# ========== 1. SSH 连通性检查 ==========
if [ $DRY_RUN -eq 1 ]; then
  warn "DRY-RUN 模式，跳过真实 SSH 连接"
else
  log "测试 SSH → $HOST:$SSH_PORT"
  run_ssh "echo OK" >/dev/null
  ok "SSH 连通"
fi

# ========== 2. 同步代码（deploy 模式才需要）==========
if [ "$CMD" = "deploy" ] && [ "$SYNC_MODE" != "skip" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  LOCAL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

  case "$SYNC_MODE" in
    git)
      log "同步代码（git pull）..."
      run_ssh "cd '$REMOTE_PATH' && git pull --rebase --autostash"
      ok "代码同步完成"
      ;;

    rsync)
      log "同步代码（rsync）..."
      log "  本地: $LOCAL_DIR"
      log "  远程: $HOST:$REMOTE_PATH"
      # 检查 rsync（Git Bash 自带但 Windows cmd 没装）
      if ! command -v rsync >/dev/null 2>&1; then
        warn "本机未安装 rsync，回退到 scp 模式（无 --delete 清理旧文件功能）"
        SYNC_MODE="scp"
      fi
      if [ "$SYNC_MODE" = "rsync" ]; then
        RSYNC_SSH="ssh ${SSH_OPTS[*]}"
        RSYNC_ARGS=(-avz --delete -e "$RSYNC_SSH"
          --exclude='node_modules' --exclude='.git'
          --exclude='backend/uploads' --exclude='frontend/dist'
          --exclude='.workbuddy' --exclude='*.log'
          --exclude='_*.log' --exclude='_verify-*.mjs' --exclude='_e2e_*.mjs'
          --exclude='_create_*.mjs' --exclude='dev.log'
          "$LOCAL_DIR/" "$HOST:$REMOTE_PATH/")
        if [ $DRY_RUN -eq 1 ]; then
          echo "[DRY-RUN] rsync ${RSYNC_ARGS[*]}"
        else
          rsync "${RSYNC_ARGS[@]}"
        fi
        ok "代码同步完成"
      fi
      ;;

    scp)
      # 回退路径：scp 整个目录
      log "同步代码（scp 全量）..."
      warn "scp 不删除远程多余文件；如需清理请用 git 模式"
      if [ $DRY_RUN -eq 1 ]; then
        echo "[DRY-RUN] scp -r $LOCAL_DIR $HOST:$REMOTE_PATH"
      else
        scp -r "${SSH_OPTS[@]}" "$LOCAL_DIR" "$HOST:$REMOTE_PATH.tmp"
        run_ssh "rm -rf '$REMOTE_PATH' && mv '$REMOTE_PATH.tmp' '$REMOTE_PATH'"
      fi
      ok "代码同步完成"
      ;;

    *)
      err "未知 sync-mode: $SYNC_MODE"
      exit 1
      ;;
  esac
fi

# ========== 3. 触发远程脚本 ==========
log "触发远程: bash scripts/deploy-remote.sh $CMD"
run_ssh "cd '$REMOTE_PATH' && bash scripts/deploy-remote.sh $CMD"
RC=$?

if [ $RC -eq 0 ]; then
  ok "✅ 部署成功"
  exit 0
else
  err "❌ 远程脚本退出码: $RC"
  if [ "$CMD" = "deploy" ]; then
    warn "如需手动回滚:"
    echo "  $0 --host $HOST --rollback"
    [ -n "$SSH_KEY" ] && echo "  (用了 --ssh-key $SSH_KEY)"
    [ "$SSH_PORT" != "22" ] && echo "  (用了 --ssh-port $SSH_PORT)"
  fi
  exit $RC
fi