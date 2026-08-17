#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$ROOT_DIR/scripts/lib/build-common.sh"

BUILD_SCOPE="${1:-all}"

case "$BUILD_SCOPE" in
  all|cli)
    ;;
  *)
    echo "Unsupported build scope: $BUILD_SCOPE"
    echo "Usage: bash ./scripts/build.sh [all|cli]"
    exit 1
    ;;
esac

if [[ "$BUILD_SCOPE" == "all" ]]; then
  # 构建顺序：City 在 Agent、Federation、Plugins 与平台 Adapter 之后装配宿主能力。
  run_project_build "$ROOT_DIR/packages/type"
  run_project_build "$ROOT_DIR/packages/workspace"
  run_project_build "$ROOT_DIR/packages/sandbox-macos"
  run_project_build "$ROOT_DIR/packages/sandbox-linux"
  run_project_build "$ROOT_DIR/packages/sandbox-windows-mxc"
  run_project_build "$ROOT_DIR/packages/sandbox-windows-srt"
  run_project_build "$ROOT_DIR/packages/agent"
  run_project_build "$ROOT_DIR/packages/workspace-cloudflare-computer"
  run_project_build "$ROOT_DIR/packages/federation"
  run_project_build "$ROOT_DIR/packages/services"
  run_project_build "$ROOT_DIR/packages/plugins"
  run_project_build "$ROOT_DIR/packages/city"
  run_project_build "$ROOT_DIR/packages/ui"
  run_project_build "$ROOT_DIR/homepage"
  run_project_build "$ROOT_DIR/packages/cli"
  install_downcity_cli_globally "$ROOT_DIR"
  exit 0
fi

# build:cli — 仅构建 CLI 交付链路
run_project_build "$ROOT_DIR/packages/type"
run_project_build "$ROOT_DIR/packages/workspace"
run_project_build "$ROOT_DIR/packages/sandbox-macos"
run_project_build "$ROOT_DIR/packages/sandbox-linux"
run_project_build "$ROOT_DIR/packages/sandbox-windows-mxc"
run_project_build "$ROOT_DIR/packages/sandbox-windows-srt"
run_project_build "$ROOT_DIR/packages/agent"
run_project_build "$ROOT_DIR/packages/federation"
run_project_build "$ROOT_DIR/packages/services"
run_project_build "$ROOT_DIR/packages/plugins"
run_project_build "$ROOT_DIR/packages/city"
run_project_build "$ROOT_DIR/packages/ui"
run_project_build "$ROOT_DIR/packages/cli"
install_downcity_cli_globally "$ROOT_DIR"
