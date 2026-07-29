/**
 * @file 验证 CLI 的 Windows 平台命令与进程模型。
 *
 * 关键点（中文）
 * - 只测试纯函数结果，不在测试进程上真实调用 taskkill。
 * - Windows 全局包管理命令必须使用 `.cmd` shim。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { resolve_command_name } from "../bin/federation/core/update.js";
import { buildDetachedProcessSignalTargets } from "../bin/city/process/registry/ProcessSweep.js";
import { resolve_windows_sandbox_selection } from "../bin/city/sandbox/PlatformSandbox.js";

async function with_platform(platform, callback) {
  const previous = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  try {
    return await callback();
  } finally {
    if (previous) Object.defineProperty(process, "platform", previous);
  }
}

test("Windows package manager commands use cmd shims", () => {
  assert.equal(resolve_command_name("npm", "win32"), "npm.cmd");
  assert.equal(resolve_command_name("pnpm", "win32"), "pnpm.cmd");
  assert.equal(resolve_command_name("node", "win32"), "node");
  assert.equal(resolve_command_name("npm", "darwin"), "npm");
});

test("Windows detached processes use one positive PID target", async () => {
  await with_platform("win32", async () => {
    assert.deepEqual(buildDetachedProcessSignalTargets(4321), [4321]);
  });
});

test("Windows sandbox keeps MXC by default and enables SRT explicitly", () => {
  assert.equal(resolve_windows_sandbox_selection({}), "mxc");
  assert.equal(resolve_windows_sandbox_selection({ DC_WINDOWS_SANDBOX: "srt" }), "srt");
  assert.throws(
    () => resolve_windows_sandbox_selection({ DC_WINDOWS_SANDBOX: "unknown" }),
    /Expected mxc or srt/,
  );
});
