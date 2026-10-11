#!/bin/zsh
set -eu
script_dir="${0:A:h}"
cd "$script_dir/app"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 24，并按 README 安装依赖及构建。'
  exit 1
fi
node scripts/init-empty-data.mjs
export ZHOUZHI_LOCAL_PREVIEW=1
exec node server/index.mjs
