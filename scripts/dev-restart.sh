#!/bin/bash
# 一键恢复开发环境：Docker → Supabase → 函数服务 → 检查前端
# 用法：bash scripts/dev-restart.sh   （Docker 已运行时约 10 秒完成）
set -e
cd "$(dirname "$0")/.."

# 1. Docker 守护进程（电脑重启后会退出）
if ! docker info >/dev/null 2>&1; then
  echo "→ 启动 Docker Desktop…"
  open -a Docker
  for i in $(seq 1 30); do sleep 5; docker info >/dev/null 2>&1 && break; done
fi
docker info >/dev/null 2>&1 && echo "✓ Docker" || { echo "✗ Docker 未就绪"; exit 1; }

# 2. Supabase 栈（数据在 volume，重启不丢）
if ! npx supabase status 2>/dev/null | grep -q "API URL"; then
  echo "→ 启动 Supabase…"
  npx supabase start >/dev/null 2>&1
fi
curl -s -o /dev/null --max-time 5 http://127.0.0.1:54321/rest/v1/ && echo "✓ Supabase API" || { echo "✗ Supabase API"; exit 1; }

# 3. 函数服务（Key 从 supabase/functions/.env 读取，该文件持久无需重新配置）
if ! pgrep -f "functions serve" >/dev/null; then
  echo "→ 启动 Edge Functions…"
  (npx supabase functions serve --env-file ./supabase/functions/.env > /tmp/functions-serve.log 2>&1 &)
  sleep 8
fi
pgrep -f "functions serve" >/dev/null && echo "✓ 函数服务" || { echo "✗ 函数服务（查看 /tmp/functions-serve.log）"; exit 1; }

# 4. 前端
curl -s -o /dev/null --max-time 5 http://localhost:5173/ && echo "✓ 前端 http://localhost:5173" \
  || echo "⚠ 前端未运行：另开终端执行 npm run dev"

echo "完成。Key 配置持久存放于 supabase/functions/.env，重启无需改配置。"
