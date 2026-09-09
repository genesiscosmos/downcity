#!/usr/bin/env bash
set -euo pipefail

# 本地构建并部署 homepage 到 Cloudflare Pages。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_NAME="${CLOUDFLARE_PAGES_PROJECT:-downcity}"
BRANCH_NAME="$(git branch --show-current)"
COMMIT_HASH="$(git rev-parse HEAD)"

if [[ -z "$BRANCH_NAME" ]]; then
  echo "无法确定当前 Git 分支。" >&2
  exit 1
fi

pnpm install --frozen-lockfile
pnpm -C packages/ui build
pnpm -C homepage typecheck
pnpm -C homepage build
(cd homepage && pnpm dlx wrangler@4.95.0 pages deploy build/client \
  --project-name "$PROJECT_NAME" \
  --branch "$BRANCH_NAME" \
  --commit-hash "$COMMIT_HASH" \
  --commit-dirty=true)
