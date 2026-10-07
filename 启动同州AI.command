#!/bin/zsh
set -e
cd "${0:A:h}/app"
export PATH="/Users/hongwen/.nvm/versions/node/v24.13.1/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-4318}"
if curl -fsS "http://127.0.0.1:$PORT/api/engine" >/dev/null 2>&1; then
  echo "同州 AI 已在运行：http://127.0.0.1:$PORT"
  open "http://127.0.0.1:$PORT"
  exit 0
fi
if [[ ! -d node_modules ]]; then npm ci; fi
if [[ ! -f dist/index.html ]]; then npm run build; fi
echo "同州 AI 正在启动。访问 http://127.0.0.1:$PORT，按 Ctrl+C 停止。"
(sleep 2; open "http://127.0.0.1:$PORT") &
exec node server/index.mjs
