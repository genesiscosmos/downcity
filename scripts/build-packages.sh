#!/usr/bin/env bash
set -euo pipefail

# Package 级 patch bump 与构建入口。
#
# 显式选择的 package 才会 bump；构建阶段会递归补齐依赖，并按照稳定拓扑顺序执行。

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
source "$ROOT_DIR/scripts/lib/build-common.sh"

PACKAGES=()
BUILD_PACKAGES=()
ALL_PACKAGES=(
  "type"
  "sandbox-microsandbox"
  "sandbox-native"
  "workspace-cloudflare-computer"
  "federation"
  "agent"
  "city"
  "database-d1"
  "database-sqlite"
  "database-postgresql"
  "services"
  "powers"
  "ui"
  "cli"
)
BUMP=true
SYNC_GLOBAL_CLI=true

usage() {
  echo "Usage: pnpm patch:build -- [packages] [--no-bump] [--no-global-install]"
  echo ""
  echo "Package options:"
  echo "  --type --sandbox-microsandbox --sandbox-native"
  echo "  --agent --city --workspace-cloudflare-computer --federation"
  echo "  --database-d1 --database-sqlite --database-postgresql"
  echo "  --services --powers --ui --cli --all"
  echo ""
  echo "  --no-bump           只构建，不修改 package version"
  echo "  --no-global-install 不同步本机全局 Downcity CLI"
  exit 1
}

contains() {
  local expected="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$expected" ]]; then return 0; fi
  done
  return 1
}

add_package() {
  local package_name="$1"
  if ! contains "$package_name" "${PACKAGES[@]}"; then
    PACKAGES+=("$package_name")
  fi
}

normalize_selected_packages() {
  local ordered=()
  local package_name
  for package_name in "${ALL_PACKAGES[@]}"; do
    if contains "$package_name" "${PACKAGES[@]}"; then
      ordered+=("$package_name")
    fi
  done
  PACKAGES=("${ordered[@]}")
}

run_build() {
  local package_name="$1"
  local package_path
  echo ""
  package_path="$(node "$ROOT_DIR/scripts/resolve-package-path.mjs" "$package_name")"
  if [[ "$package_name" == "cli" ]]; then
    echo "--- Downcity CLI ---"
  else
    echo "--- @downcity/$package_name ---"
  fi
  run_project_build "$ROOT_DIR/$package_path"
}

should_sync_global_cli() {
  local dependency_name
  while IFS= read -r dependency_name; do
    if contains "$dependency_name" "${PACKAGES[@]}"; then return 0; fi
  done < <(node "$ROOT_DIR/scripts/resolve-package-build-order.mjs" cli)
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; continue ;;
    --type) add_package "type" ;;
    --sandbox-microsandbox) add_package "sandbox-microsandbox" ;;
    --sandbox-native) add_package "sandbox-native" ;;
    --agent) add_package "agent" ;;
    --city) add_package "city" ;;
    --workspace-cloudflare-computer) add_package "workspace-cloudflare-computer" ;;
    --federation) add_package "federation" ;;
    --database-d1) add_package "database-d1" ;;
    --database-sqlite) add_package "database-sqlite" ;;
    --database-postgresql) add_package "database-postgresql" ;;
    --services) add_package "services" ;;
    --powers) add_package "powers" ;;
    --ui) add_package "ui" ;;
    --cli) add_package "cli" ;;
    --all) PACKAGES=("${ALL_PACKAGES[@]}") ;;
    --no-bump) BUMP=false ;;
    --no-global-install) SYNC_GLOBAL_CLI=false ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
  shift
done

if [[ ${#PACKAGES[@]} -eq 0 ]]; then
  echo "Error: 至少需要显式指定一个 package，例如 --agent 或 --agent --powers。" >&2
  usage
fi

normalize_selected_packages
while IFS= read -r package_name; do
  BUILD_PACKAGES+=("$package_name")
done < <(node "$ROOT_DIR/scripts/resolve-package-build-order.mjs" "${PACKAGES[@]}")

if $BUMP; then
  echo "==> patch bump: ${PACKAGES[*]}"
  for package_name in "${PACKAGES[@]}"; do
    package_path="$(node "$ROOT_DIR/scripts/resolve-package-path.mjs" "$package_name")"
    node "$ROOT_DIR/scripts/bump-package-version.mjs" "$ROOT_DIR/$package_path/package.json"
  done
else
  echo "==> patch bump skipped"
fi

echo "==> 构建 ${BUILD_PACKAGES[*]} ..."
for package_name in "${BUILD_PACKAGES[@]}"; do
  run_build "$package_name"
done

echo ""
echo "==> 完成"

if $SYNC_GLOBAL_CLI && should_sync_global_cli; then
  if ! contains "cli" "${BUILD_PACKAGES[@]}"; then
    echo ""
    echo "==> 刷新 Downcity CLI 交付产物 ..."
    run_build "cli"
  fi

  echo ""
  echo "==> 全局安装 Downcity CLI ..."
  install_downcity_cli_globally "$ROOT_DIR"
fi
