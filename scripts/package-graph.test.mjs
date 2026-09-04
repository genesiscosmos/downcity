/**
 * @file manifest 驱动 package graph 测试。
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  resolve_package_build_order,
  resolve_package_path,
} from "./package-graph.mjs";

const workspace_root = path.resolve(import.meta.dirname, "..");

test("Workspace 构建会自动补齐 Type", () => {
  assert.deepEqual(
    resolve_package_build_order(workspace_root, ["workspace"]),
    ["type", "workspace"],
  );
});

test("CLI 构建闭包完全来自 manifest 运行时依赖", () => {
  assert.deepEqual(
    resolve_package_build_order(workspace_root, ["cli"]),
    [
      "type",
      "federation",
      "workspace",
      "plugin",
      "sandbox-linux",
      "sandbox-macos",
      "sandbox-windows-mxc",
      "sandbox-windows-srt",
      "agent",
      "city",
      "plugins",
      "cli",
    ],
  );
});

test("分组 package 与应用 package 都按 manifest 身份解析真实目录", () => {
  assert.equal(resolve_package_path(workspace_root, "database-d1"), "packages/implementations/databases/d1");
  assert.equal(resolve_package_path(workspace_root, "plugins"), "packages/implementations/plugins");
  assert.equal(resolve_package_path(workspace_root, "sandbox-macos"), "packages/implementations/sandboxes/macos");
  assert.equal(resolve_package_path(workspace_root, "services"), "packages/implementations/services");
  assert.equal(resolve_package_path(workspace_root, "workspace-cloudflare-computer"), "packages/implementations/workspaces/cloudflare-computer");
  assert.equal(resolve_package_path(workspace_root, "cli"), "app/cli");
});
