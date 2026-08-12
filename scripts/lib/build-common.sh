#!/usr/bin/env bash

# Downcity 构建脚本公共函数。
#
# 关键点（中文）：
# - 所有仓库级构建脚本共用这里的 pnpm/npm fallback 与 CLI 全局安装逻辑。
# - 避免 build.sh / build-packages.sh 分叉维护，减少 CLI 发布链路漂移。

run_project_build() {
  local project_dir="$1"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm -C "$project_dir" build
  else
    npm --prefix "$project_dir" run build
  fi
}

sync_downcity_workspace_package_globally() {
  local workspace_root="$1"
  local package_dir="$2"
  local package_name="$3"
  local source_dir
  local target_link
  local target_dir

  source_dir="$workspace_root/packages/$package_name"
  target_link="$package_dir/node_modules/@downcity/$package_name"
  if [[ ! -d "$source_dir" || ! -e "$target_link" ]]; then
    return 0
  fi

  target_dir="$(cd "$target_link" && pwd -P)"
  if [[ -z "$target_dir" || ! -d "$target_dir" ]]; then
    return 0
  fi

  # 关键点（中文）：保留全局依赖包自己的 node_modules，只刷新 workspace 包源码与构建产物。
  rsync -a --delete --exclude node_modules "$source_dir/" "$target_dir/"
}

sync_downcity_workspace_packages_globally() {
  local workspace_root="$1"
  local package_dir="$2"
  local package_name

  for package_name in type shell sandbox-macos sandbox-linux sandbox-windows-mxc sandbox-windows-srt agent local city services plugins ui; do
    sync_downcity_workspace_package_globally "$workspace_root" "$package_dir" "$package_name"
  done
}

deploy_downcity_cli_package() {
  local package_dir="$1"
  local deploy_dir="$2"

  pnpm --filter downcity deploy --legacy "$deploy_dir"
  rm -rf "$package_dir"
  cp -R "$deploy_dir" "$package_dir"
}

downcity_global_runtime_has_required_dependencies() {
  local package_dir="$1"
  local manifest_path="$2"

  node --input-type=module - "$package_dir" "$manifest_path" <<'EOF'
import fs from "node:fs";
import path from "node:path";

const [, , package_dir, manifest_path] = process.argv;
const manifest = JSON.parse(fs.readFileSync(manifest_path, "utf8"));
const platform_sandbox = process.platform === "darwin"
  ? "@downcity/sandbox-macos"
  : process.platform === "linux"
    ? "@downcity/sandbox-linux"
    : process.platform === "win32"
      ? process.env.DC_WINDOWS_SANDBOX === "srt"
        ? "@downcity/sandbox-windows-srt"
        : "@downcity/sandbox-windows-mxc"
      : "";
const dependencies = [
  ...Object.keys(manifest.dependencies || {}),
  ...(platform_sandbox ? [platform_sandbox] : []),
];

for (const dependency_name of dependencies) {
  const dependency_path = path.join(
    package_dir,
    "node_modules",
    ...dependency_name.split("/"),
  );

  if (!fs.existsSync(dependency_path)) {
    console.error(`Missing global dependency: ${dependency_name}`);
    process.exit(10);
  }
}
EOF
  local status=$?
  if [[ "$status" -eq 10 ]]; then
    return 1
  fi
  return "$status"
}

install_downcity_cli_globally() {
  local workspace_root="$1"
  local deploy_dir
  local npm_prefix
  local global_modules
  local global_bin
  local package_dir
  local source_dir
  local legacy_command

  npm_prefix="$(npm prefix -g)"
  global_modules="$npm_prefix/lib/node_modules"
  global_bin="$npm_prefix/bin"
  package_dir="$global_modules/downcity"
  source_dir="$workspace_root/packages/cli"
  legacy_command="stu""dio"

  if [[ ! -f "$source_dir/bin/downcity.js" || ! -f "$source_dir/bin/downfed.js" ]]; then
    echo "Missing Downcity CLI build output. Run packages/cli build first." >&2
    return 1
  fi

  # 关键点（中文）：本地开发时 `npm link` 会让全局 downcity 指向 workspace 的 packages/cli。
  # 这种情况下 source_dir 与 package_dir 是同一个真实目录，不能执行增量同步里的 rm/cp，
  # 否则会把 workspace 自己的 bin / README / package.json 删掉。
  if [[ -e "$package_dir" ]]; then
    local resolved_package_dir
    local resolved_source_dir
    resolved_package_dir="$(cd "$package_dir" && pwd -P)"
    resolved_source_dir="$(cd "$source_dir" && pwd -P)"
    if [[ "$resolved_package_dir" == "$resolved_source_dir" ]]; then
      chmod +x "$source_dir/bin/downcity.js" "$source_dir/bin/downfed.js"
      rm -f "$global_bin/$legacy_command" "$global_bin/city" "$global_bin/downcity" "$global_bin/downfed" "$global_bin/fed" 2>/dev/null || true
      ln -s "../lib/node_modules/downcity/bin/downcity.js" "$global_bin/city"
      ln -s "../lib/node_modules/downcity/bin/downcity.js" "$global_bin/downcity"
      ln -s "../lib/node_modules/downcity/bin/downfed.js" "$global_bin/downfed"
      ln -s "../lib/node_modules/downcity/bin/downfed.js" "$global_bin/fed"
      return 0
    fi
  fi

  mkdir -p "$global_modules" "$global_bin" "$package_dir"

  # 关键点（中文）：日常 patch build 已经构建好了 packages/cli，不需要再 `pnpm deploy`
  # 联网解析依赖。只更新 CLI 代码，并复用全局安装中已有的 node_modules。
  if [[ -d "$package_dir/node_modules" ]]; then
    rm -rf \
      "$package_dir/bin" \
      "$package_dir/README.md" \
      "$package_dir/package.json"
    cp -R "$source_dir/bin" "$package_dir/bin"
    cp "$source_dir/README.md" "$package_dir/README.md"
    cp "$source_dir/package.json" "$package_dir/package.json"
    sync_downcity_workspace_packages_globally "$workspace_root" "$package_dir"

    # 关键点（中文）：如果这次 CLI 引入了新的直连依赖，增量同步无法补齐 node_modules，
    # 这里自动回退到一次完整 deploy，避免全局 `city` 因缺依赖直接崩溃。
    if ! downcity_global_runtime_has_required_dependencies "$package_dir" "$source_dir/package.json"; then
      deploy_dir="$(mktemp -d "${TMPDIR:-/tmp}/downcity-cli-deploy.XXXXXX")"
      trap 'rm -rf "$deploy_dir"' RETURN
      deploy_downcity_cli_package "$package_dir" "$deploy_dir"
    fi
  else
    # 关键点（中文）：首次全局安装没有依赖目录时，仍需要 deploy 生成完整依赖树。
    deploy_dir="$(mktemp -d "${TMPDIR:-/tmp}/downcity-cli-deploy.XXXXXX")"
    trap 'rm -rf "$deploy_dir"' RETURN

    deploy_downcity_cli_package "$package_dir" "$deploy_dir"
  fi

  chmod +x "$package_dir/bin/downcity.js" "$package_dir/bin/downfed.js"

  rm -f "$global_bin/$legacy_command" "$global_bin/city" "$global_bin/downcity" "$global_bin/downfed" "$global_bin/fed" 2>/dev/null || true
  ln -s "../lib/node_modules/downcity/bin/downcity.js" "$global_bin/city"
  ln -s "../lib/node_modules/downcity/bin/downcity.js" "$global_bin/downcity"
  ln -s "../lib/node_modules/downcity/bin/downfed.js" "$global_bin/downfed"
  ln -s "../lib/node_modules/downcity/bin/downfed.js" "$global_bin/fed"
}
