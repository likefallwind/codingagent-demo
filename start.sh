#!/usr/bin/env bash
#
# LearnAI 启动脚本
#
#   ./start.sh          开发模式：Vite :5173 + API :8787，改代码自动重载
#   ./start.sh prod     生产模式：先构建，再由单个进程托管（:8787）
#   ./start.sh test     跑单元测试
#   ./start.sh stop     停掉本脚本启动的残留进程
#
# 它替你处理的都是实际会卡住人的事：缺依赖、缺 API key、端口被占、
# Node 版本过低、Ctrl+C 之后进程没清干净。

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${PORT:-8787}"
MODE="${1:-dev}"

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
info() { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$c_grn" "$c_off" "$*"; }
warn() { printf '%s!%s %s\n' "$c_yel" "$c_off" "$*"; }
die()  { printf '%s✗%s %s\n' "$c_red" "$c_off" "$*" >&2; exit 1; }

# 用 Node 自己探测端口：不依赖 ss/lsof/nc，也不会像 /dev/tcp 那样挂住。
port_busy() {
  node -e '
    const net = require("net"), s = net.createServer();
    s.once("error", e => process.exit(e.code === "EADDRINUSE" ? 0 : 1));
    s.once("listening", () => s.close(() => process.exit(1)));
    s.listen(Number(process.argv[1]), "127.0.0.1");
  ' "$1" 2>/dev/null
}

port_owner() {
  { command -v lsof >/dev/null && lsof -ti tcp:"$1" 2>/dev/null; } ||
  { command -v fuser >/dev/null && fuser "$1"/tcp 2>/dev/null | tr -d ' '; } || true
}

# ---------------------------------------------------------------- stop
if [ "$MODE" = "stop" ]; then
  stopped=0
  for port in "$WEB_PORT" "$API_PORT"; do
    for pid in $(port_owner "$port"); do
      kill "$pid" 2>/dev/null && { ok "已停止占用 :$port 的进程 (pid $pid)"; stopped=1; }
    done
  done
  [ "$stopped" = 0 ] && info "没有找到正在运行的进程。"
  exit 0
fi

# ---------------------------------------------------------------- 环境检查
command -v node >/dev/null || die "未找到 node。需要 Node 18 或更高版本。"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node 版本过低（当前 $(node -v)），Vite 需要 18 以上。"

# .env 里的变量不覆盖你已经导出的同名变量——shell 里临时设的优先级更高。
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  ok "已读取 .env"
fi

if [ ! -d node_modules ]; then
  info "首次运行，正在安装依赖…"
  npm install --no-fund --no-audit
  ok "依赖安装完成"
fi

if [ -z "${MINIMAX_API_KEY:-}" ]; then
  warn "未设置 MINIMAX_API_KEY —— 网站照常可用，但 AI 批改、提示、问答会返回 502。"
  warn "  设置方法：export MINIMAX_API_KEY=...   或写进项目根目录的 .env"
else
  ok "MINIMAX_API_KEY 已设置"
fi

# ---------------------------------------------------------------- test
if [ "$MODE" = "test" ]; then
  exec npm test
fi

# ---------------------------------------------------------------- 端口
needed=("$API_PORT")
[ "$MODE" = "dev" ] && needed=("$WEB_PORT" "$API_PORT")
for port in "${needed[@]}"; do
  if port_busy "$port"; then
    owner="$(port_owner "$port")"
    die "端口 $port 已被占用${owner:+（pid $owner）}。先运行 ./start.sh stop，或换端口：WEB_PORT=3000 PORT=3001 ./start.sh"
  fi
done

# 无论怎么退出，都不留下孤儿进程。
cleanup() {
  trap - INT TERM EXIT
  [ -n "${CHILD:-}" ] && kill -- -"$CHILD" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# ---------------------------------------------------------------- 启动
case "$MODE" in
  dev)
    info ""
    info "开发模式启动中…"
    info "  ${c_dim}前端${c_off} http://localhost:$WEB_PORT   ${c_dim}← 打开这个${c_off}"
    info "  ${c_dim}接口${c_off} http://localhost:$API_PORT"
    info "  ${c_dim}Ctrl+C 停止${c_off}"
    info ""
    set -m
    PORT="$API_PORT" npx concurrently -n web,api -c cyan,magenta \
      "npx vite --port $WEB_PORT" "node --watch server/index.js" &
    CHILD=$!
    wait "$CHILD"
    ;;

  prod)
    info "正在构建…"
    npm run build
    ok "构建完成"
    info ""
    info "生产模式：单进程托管"
    info "  http://localhost:$API_PORT   ${c_dim}← 打开这个${c_off}"
    info "  ${c_dim}Ctrl+C 停止${c_off}"
    info ""
    set -m
    PORT="$API_PORT" node server/index.js &
    CHILD=$!
    wait "$CHILD"
    ;;

  *)
    die "未知模式：$MODE（可用：dev / prod / test / stop）"
    ;;
esac
