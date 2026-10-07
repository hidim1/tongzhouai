#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
HERE="$PWD"
STATE="$HOME/Library/Caches/TongzhouAI-SSH"
SOCKET="$STATE/tunnel.sock"
TARGET="root@36.140.247.61"
URL="http://127.0.0.1:14318"
mkdir -p "$STATE"
chmod 700 "$STATE"
new_connection=0
fail() { printf '\n%s\n' "$1"; exit 1; }
cleanup_failed() {
  if [ "$new_connection" = 1 ]; then
    /usr/bin/ssh -F /dev/null -S "$SOCKET" -O exit "$TARGET" >/dev/null 2>&1 || true
  fi
}
trap cleanup_failed EXIT

if ! /usr/bin/ssh -F /dev/null -S "$SOCKET" -O check "$TARGET" >/dev/null 2>&1; then
  if /usr/sbin/lsof -nP -iTCP:14318 -sTCP:LISTEN >/dev/null 2>&1; then
    fail "本机端口 14318 已被占用；未连接，也不会关闭占用它的其他程序。"
  fi
  printf '同舟 AI · 云端私有工作区\n请输入服务器 SSH 密码（输入时不显示字符）。\n'
  /usr/bin/ssh -F /dev/null -M -S "$SOCKET" -f -N \
    -o "UserKnownHostsFile=$HERE/ssh-known-hosts" \
    -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 \
    -o ExitOnForwardFailure=yes -o ConnectTimeout=15 \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -L 127.0.0.1:14318:127.0.0.1:4318 "$TARGET"
  new_connection=1
fi

ready=0
for attempt in {1..15}; do
  if /usr/bin/curl --noproxy '*' -fsS --max-time 3 "$URL/api/bootstrap" | /usr/bin/grep -q '"brand"'; then
    ready=1; break
  fi
  sleep 1
done
[ "$ready" = 1 ] || fail "SSH 已连接，但同舟 AI 服务未响应。请检查服务器 tongzhou-ai 服务。"
new_connection=0
printf '\n已连接：%s\n流量通过 SSH 加密，项目保存在服务器。\n用「停止同舟AI隧道.command」断开连接；本窗口可以关闭。\n' "$URL"
if [ "${TONGZHOU_NO_BROWSER:-0}" != 1 ]; then
  /usr/bin/open "$URL"
fi
