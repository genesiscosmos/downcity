/**
 * @file workspace 依赖发布改写脚本测试。
 *
 * 测试目标：
 * - `prepare` 会把当前 package 的 `workspace:*` / `workspace:^` 改成 npm 可发布版本。
 * - `restore` 会恢复原始 package.json，避免污染 workspace 开发态。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const script_path = path.resolve("scripts/rewrite-workspace-dependencies.mjs");

/**
 * 写入格式化 JSON。
 *
 * @param {string} file_path 文件路径。
 * @param {unknown} value JSON 内容。
 */
function write_json(file_path, value) {
  fs.writeFileSync(file_path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * 读取 JSON 文件。
 *
 * @param {string} file_path 文件路径。
 * @returns {unknown} JSON 内容。
 */
function read_json(file_path) {
  return JSON.parse(fs.readFileSync(file_path, "utf8"));
}

test("rewrite workspace dependencies for npm pack and restore source manifest", () => {
  const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), "downcity-pack-"));
  const package_dir = path.join(temp_dir, "packages", "agent");
  const type_dir = path.join(temp_dir, "packages", "type");
  const workspace_dir = path.join(temp_dir, "packages", "workspace");

  fs.mkdirSync(package_dir, { recursive: true });
  fs.mkdirSync(type_dir, { recursive: true });
  fs.mkdirSync(workspace_dir, { recursive: true });
  fs.writeFileSync(path.join(temp_dir, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");

  write_json(path.join(type_dir, "package.json"), {
    name: "@downcity/type",
    version: "0.1.43",
  });
  write_json(path.join(workspace_dir, "package.json"), {
    name: "@downcity/workspace",
    version: "0.1.4",
  });
  write_json(path.join(package_dir, "package.json"), {
    name: "@downcity/agent",
    version: "1.1.118",
    dependencies: {
      "@downcity/type": "workspace:*",
      "@downcity/workspace": "workspace:^",
      zod: "^4.4.3",
    },
  });

  const manifest_path = path.join(package_dir, "package.json");

  execFileSync(process.execPath, [script_path, "prepare", manifest_path], {
    cwd: temp_dir,
  });

  assert.deepEqual(read_json(manifest_path).dependencies, {
    "@downcity/type": "0.1.43",
    "@downcity/workspace": "^0.1.4",
    zod: "^4.4.3",
  });

  execFileSync(process.execPath, [script_path, "restore", manifest_path], {
    cwd: temp_dir,
  });

  assert.deepEqual(read_json(manifest_path).dependencies, {
    "@downcity/type": "workspace:*",
    "@downcity/workspace": "workspace:^",
    zod: "^4.4.3",
  });
});
