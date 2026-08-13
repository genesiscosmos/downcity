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
  "shell"
  "sandbox-macos"
  "sandbox-linux"
  "sandbox-windows-mxc"
  "sandbox-windows-srt"
  "agent"
  "workspace-cloudflare-computer"
  "federation"
  "database-d1"
  "database-sqlite"
  "database-postgresql"
  "services"
  "plugins"
  "city"
  "local"
  "ui"
  "cli"
)
BUMP=true
SYNC_GLOBAL_CLI=true

usage() {
  echo "Usage: pnpm patch:build -- [packages] [--no-bump] [--no-global-install]"
  echo ""
  echo "Package options:"
  echo "  --type --shell --sandbox-macos --sandbox-linux"
  echo "  --sandbox-windows-mxc --sandbox-windows-srt"
  echo "  --agent --workspace-cloudflare-computer --federation"
  echo "  --database-d1 --database-sqlite --database-postgresql"
  echo "  --services --plugins --city --local --ui --cli --all"
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

add_build_package() {
  local package_name="$1"
  if contains "$package_name" "${BUILD_PACKAGES[@]}"; then return 0; fi
  BUILD_PACKAGES+=("$package_name")

  case "$package_name" in
    shell)
      add_build_package "type"
      ;;
    sandbox-*)
      add_build_package "shell"
      ;;
    agent)
      add_build_package "type"
      add_build_package "shell"
      ;;
    workspace-cloudflare-computer)
      add_build_package "agent"
      ;;
    federation|database-*)
      add_build_package "type"
      if [[ "$package_name" == database-* ]]; then
        add_build_package "federation"
      fi
      ;;
    services)
      add_build_package "type"
      add_build_package "federation"
      ;;
    plugins)
      add_build_package "type"
      add_build_package "shell"
      add_build_package "agent"
      ;;
    city)
      add_build_package "type"
      add_build_package "agent"
      ;;
    local)
      add_build_package "agent"
      ;;
    cli)
      add_build_package "city"
      add_build_package "local"
      add_build_package "services"
      add_build_package "ui"
      ;;
  esac
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

normalize_build_packages() {
  local ordered=()
  local package_name
  for package_name in "${ALL_PACKAGES[@]}"; do
    if contains "$package_name" "${BUILD_PACKAGES[@]}"; then
      ordered+=("$package_name")
    fi
  done
  BUILD_PACKAGES=("${ordered[@]}")
}

run_build() {
  local package_name="$1"
  echo ""
  if [[ "$package_name" == "cli" ]]; then
    echo "--- Downcity CLI ---"
    run_project_build "$ROOT_DIR/packages/cli"
    return 0
  fi
  echo "--- @downcity/$package_name ---"
  run_project_build "$ROOT_DIR/packages/$package_name"
}

should_sync_global_cli() {
  local package_name
  for package_name in "${PACKAGES[@]}"; do
    case "$package_name" in
      agent|federation|plugins|city|local|ui|cli)
        return 0
        ;;
    esac
  done
  return 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --) shift; continue ;;
    --type) add_package "type" ;;
    --shell) add_package "shell" ;;
    --sandbox-macos) add_package "sandbox-macos" ;;
    --sandbox-linux) add_package "sandbox-linux" ;;
    --sandbox-windows-mxc) add_package "sandbox-windows-mxc" ;;
    --sandbox-windows-srt) add_package "sandbox-windows-srt" ;;
    --agent) add_package "agent" ;;
    --workspace-cloudflare-computer) add_package "workspace-cloudflare-computer" ;;
    --federation) add_package "federation" ;;
    --database-d1) add_package "database-d1" ;;
    --database-sqlite) add_package "database-sqlite" ;;
    --database-postgresql) add_package "database-postgresql" ;;
    --services) add_package "services" ;;
    --plugins) add_package "plugins" ;;
    --city) add_package "city" ;;
    --local) add_package "local" ;;
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
  echo "Error: 至少需要显式指定一个 package，例如 --city 或 --agent --plugins。" >&2
  usage
fi

normalize_selected_packages
for package_name in "${PACKAGES[@]}"; do
  add_build_package "$package_name"
done
normalize_build_packages

if $BUMP; then
  echo "==> patch bump: ${PACKAGES[*]}"
  for package_name in "${PACKAGES[@]}"; do
    if [[ "$package_name" == "cli" ]]; then
      node "$ROOT_DIR/scripts/bump-package-version.mjs" "$ROOT_DIR/packages/cli/package.json"
    else
      node "$ROOT_DIR/scripts/bump-package-version.mjs" "$ROOT_DIR/packages/$package_name/package.json"
    fi
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
