#!/usr/bin/env bash
#
# LearnAI 启动脚本
#
#   ./start.sh          开发模式：Vite :5173 + API :8787，改代码自动重载
#   ./start.sh prod     生产模式：先构建，再由单个进程托管（:8787）
#   ./start.sh test     跑单元测试
#   ./start.sh e2e      真浏览器验收：整门课走两遍 + AC-01~14 逐条（默认用离线 AI 替身，约 5 分钟）
#                       E2E_REAL_LLM=1 ./start.sh e2e 改用真实模型（需要 API key）
#   ./start.sh stop     停掉本项目开着的全部进程（不限于本脚本启动的）
#
# 端口被占时会自动顺延（5173 → 5174 → …），实际用的端口以启动时打印的为准。
# 它替你处理的都是实际会卡住人的事：缺依赖、缺 API key、端口被占、
# Node 版本过低、Ctrl+C 之后进程没清干净。

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

WEB_PORT="${WEB_PORT:-5173}"
API_PORT="${PORT:-8787}"
MODE="${1:-dev}"
RUN_DIR=".run"            # 每个运行中的实例一个文件：.run/<pid>，记端口，供 stop 报告用
RUN_FILE="$RUN_DIR/$$"

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

# 进程 $1 的工作目录：Linux 读 /proc，macOS 没有 /proc，退回 lsof。
proc_cwd() {
  if [ -d /proc/"$1" ]; then readlink /proc/"$1"/cwd 2>/dev/null
  else lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; fi
}

# ---------------------------------------------------------------- stop
# 停掉本项目开着的全部进程，不管是怎么起的：./start.sh（前台、后台、开了几个、
# 端口顺延到哪）、npm run dev、手敲的 node server/index.js、旧版脚本留下的……
# 不靠记录，直接扫进程表。认领规则：工作目录在本项目内，且命令行是下面几种
# 之一；命中后连同它的整棵子进程树一起停。同目录下的编辑器、终端 shell、
# 运行 stop 的这串祖先进程都对不上，不会被误伤。
# start.sh 必须是 shell 直接执行的脚本参数；`bash -c "…start.sh…"` 这种
# 包装命令串不算，否则会连带停掉包装它的 shell 和它的其他子进程。
OURS='^([^ ]*/)?(ba|z|da)?sh( -[^c ][^ ]*)* ([^ ]*/)?start\.sh( |$)'
OURS+='|^[^ ]*npm (run|exec|start)( |$)'
OURS+='|node_modules/\.bin/(concurrently|vite)( |$)|vite/bin/vite\.js'
OURS+='|^[^ ]*node .*server/index\.js'

if [ "$MODE" = "stop" ]; then
  root="$(pwd -P)"
  table="$(ps -Ao pid=,ppid=,args=)"

  claimed=""
  for pid in $(printf '%s\n' "$table" | OURS="$OURS" awk '
      { pid = $1; $1 = $2 = ""; sub(/^ +/, ""); if ($0 ~ ENVIRON["OURS"]) print pid }'); do
    cwd="$(proc_cwd "$pid" || true)"
    case "$cwd" in "$root"|"$root"/*) claimed="$claimed $pid" ;; esac
  done

  # 每行：pid <TAB> 是否为树顶 <TAB> 命令行
  targets="$(printf '%s\n' "$table" | awk -v claimed="$claimed" -v self="$$" '
    { pid = $1; parent[pid] = $2; kids[$2] = kids[$2] " " pid
      $1 = $2 = ""; sub(/^ +/, ""); cmd[pid] = $0 }
    function take(p, set,   k, n, i) {
      set[p] = 1
      n = split(kids[p], k, " ")
      for (i = 1; i <= n; i++) if (!(k[i] in set)) take(k[i], set)
    }
    END {
      take(self, spare)
      for (p = self; p in parent; ) { p = parent[p]; if (p in spare) break; spare[p] = 1 }
      n = split(claimed, c, " ")
      for (i = 1; i <= n; i++) take(c[i], hit)
      for (p in hit) if (!(p in spare)) printf "%s\t%d\t%s\n", p, !(parent[p] in hit), cmd[p]
    }')"

  if [ -z "$targets" ]; then
    rm -f "$RUN_DIR"/*
    info "没有找到正在运行的进程。"
    exit 0
  fi

  # 端口记录要在停之前读：start.sh 收到 TERM 后会自己删掉它。
  report=""
  while IFS=$'\t' read -r pid top cmd; do
    [ "$top" = 1 ] || continue
    ports=""
    if [ -f "$RUN_DIR/$pid" ]; then
      WEB_PORT=""; API_PORT=""
      # shellcheck disable=SC1090
      . "$RUN_DIR/$pid"
      ports="（${WEB_PORT:+前端 :$WEB_PORT，}接口 :$API_PORT）"
    fi
    [ "${#cmd}" -le 70 ] || cmd="${cmd:0:67}..."
    report+="pid $pid  $cmd$ports"$'\n'
  done <<< "$targets"

  # 先 TERM，让 start.sh 的 cleanup 和 node --watch 体面退出；3 秒后还在的
  # （比如被 Ctrl+Z 挂起、收不到 TERM 的）直接 KILL。
  pids="$(printf '%s\n' "$targets" | cut -f1 | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill -TERM $pids 2>/dev/null || true
  alive="$pids"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    still=""
    for p in $alive; do kill -0 "$p" 2>/dev/null && still="$still $p"; done
    alive="$still"
    [ -n "$alive" ] || break
    sleep 0.3
  done
  # shellcheck disable=SC2086
  [ -z "$alive" ] || kill -KILL $alive 2>/dev/null || true

  while IFS= read -r line; do [ -n "$line" ] && ok "已停止 $line"; done <<< "$report"
  info "${c_dim}共 $(wc -w <<< "$pids" | tr -d ' ') 个进程${c_off}"
  rm -f "$RUN_DIR"/*
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

if [ ! -f public/pyodide/v0.27.7/VENDORED.json ]; then
  warn "结课项目的 Python 运行环境还没存到本地，会从 CDN 下载（约 40 MB，网络慢时要几分钟）。"
  warn "  试点前建议先跑一次：npm run pyodide"
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

# ---------------------------------------------------------------- e2e
# 自己构建、自己找空闲端口起服务，跑完自己关，不碰开着的开发实例。
if [ "$MODE" = "e2e" ]; then
  if [ "${E2E_REAL_LLM:-}" = "1" ]; then
    [ -n "${MINIMAX_API_KEY:-}" ] || die "E2E_REAL_LLM=1 要和真实的 AI 老师对话，需要 MINIMAX_API_KEY。"
  fi
  exec npm run e2e
fi

# ---------------------------------------------------------------- 端口
# 端口被占不再直接退出，而是顺延到下一个空闲端口。提示信息走 stderr，
# 因为这个函数的 stdout 就是选中的端口号。
RESERVED=""
PORT_SCAN_LIMIT=20

find_free_port() {
  local port="$1" label="$2" tries=0 owner
  while port_busy "$port" || [[ " $RESERVED " == *" $port "* ]]; do
    owner="$(port_owner "$port")"
    warn "$label 端口 $port 已被占用${owner:+（pid $owner）}，改用 $((port + 1))。" >&2
    port=$((port + 1))
    tries=$((tries + 1))
    [ "$tries" -lt "$PORT_SCAN_LIMIT" ] ||
      die "从 $1 开始的 $PORT_SCAN_LIMIT 个端口都被占用。先运行 ./start.sh stop，或手动指定：WEB_PORT=3000 PORT=3001 ./start.sh"
  done
  printf '%s' "$port"
}

API_PORT="$(find_free_port "$API_PORT" "接口")"
RESERVED="$API_PORT"
if [ "$MODE" = "dev" ]; then
  WEB_PORT="$(find_free_port "$WEB_PORT" "前端")"
fi

# 记下实际端口，stop 时报告用。每个实例一个文件，多开互不覆盖。
mkdir -p "$RUN_DIR"
[ "$MODE" = "dev" ] || WEB_PORT=""
printf 'WEB_PORT=%s\nAPI_PORT=%s\n' "$WEB_PORT" "$API_PORT" > "$RUN_FILE"

# 无论怎么退出，都不留下孤儿进程。
cleanup() {
  trap - INT TERM EXIT
  [ -n "${CHILD:-}" ] && kill -- -"$CHILD" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -f "$RUN_FILE"
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
      "npx vite --port $WEB_PORT --strictPort" "node --watch server/index.js" &
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
    die "未知模式：$MODE（可用：dev / prod / test / e2e / stop）"
    ;;
esac
