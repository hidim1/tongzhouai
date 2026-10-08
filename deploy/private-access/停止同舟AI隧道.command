#!/bin/bash
set -euo pipefail
SOCKET="$HOME/Library/Caches/TongzhouAI-SSH/tunnel.sock"
if /usr/bin/ssh -F /dev/null -S "$SOCKET" -O check root@36.140.247.61 >/dev/null 2>&1; then
  /usr/bin/ssh -F /dev/null -S "$SOCKET" -O exit root@36.140.247.61
  echo '舟知隧道已断开。服务器应用与项目数据不受影响。'
else
  echo '没有由此启动器建立的活动隧道。'
fi
