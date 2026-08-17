/**
 * @file 验证跨平台 Shell 命令解释器模型。
 *
 * 关键点（中文）
 * - 测试只验证稳定的调用协议，不依赖当前测试宿主实际安装 cmd.exe。
 * - Windows 命令必须显式使用 cmd `/d /s /c`，不能回退 Node `shell: true`。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  build_shell_command_invocation,
  resolve_default_shell_path,
} from "../bin/shell/session/ShellCommandModel.js";

test("Windows defaults to ComSpec and uses the cmd execution model", () => {
  assert.equal(
    resolve_default_shell_path("win32", { ComSpec: "C:\\Windows\\System32\\cmd.exe" }),
    "C:\\Windows\\System32\\cmd.exe",
  );
  assert.deepEqual(build_shell_command_invocation({
    shell_path: "cmd.exe",
    cmd: "set NAME=downcity && echo %NAME%",
    login: true,
    platform: "win32",
  }), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "set NAME=downcity && echo %NAME%"],
  });
});

test("POSIX shells retain login and non-login argument models", () => {
  assert.deepEqual(build_shell_command_invocation({
    shell_path: "/bin/zsh",
    cmd: "echo ok",
    login: true,
    platform: "darwin",
  }).args, ["-lc", "echo ok"]);
  assert.deepEqual(build_shell_command_invocation({
    shell_path: "/bin/sh",
    cmd: "echo ok",
    login: false,
    platform: "linux",
  }).args, ["-c", "echo ok"]);
});
