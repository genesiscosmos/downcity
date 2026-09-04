/**
 * @file Anthropic SRT 原生 Windows 集成测试。
 *
 * 关键点（中文）
 * - 只有 Windows CI 显式完成 setup 后才运行。
 * - 同时验证环境变量、PATH 工具、workspace 写权限和项目外写隔离。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  closeAllShellSessions,
  createShellRuntimeState,
  execShellCommand,
} from "@downcity/workspace/shell/session/ShellActionRuntime.js";
import { WindowsSrtSandbox } from "../bin/index.js";

const exec_file = promisify(execFile);

/** 返回当前 Windows Runner 用户的稳定 SID。 */
async function read_current_user_sid() {
  const { stdout } = await exec_file("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const match = stdout.match(/"(S-1-[^"]+)"/iu);
  if (!match) throw new Error(`Unable to resolve current Windows user SID: ${stdout}`);
  return match[1];
}

/**
 * 移除临时测试根目录继承的宽松 ACL。
 *
 * GitHub Runner 的临时目录可能授予 Authenticated Users 写权限，而 SRT 当前采用独立用户和
 * additive ALLOW ACL。先收紧 fixture 根目录，才能验证 workspace grant 而不把 Runner ACL
 * 误判为 SRT 的隔离能力。
 */
async function harden_fixture_acl(fixture_root) {
  const current_user_sid = await read_current_user_sid();
  await exec_file("icacls.exe", [
    fixture_root,
    "/grant:r",
    `*${current_user_sid}:(OI)(CI)F`,
  ]);
  await exec_file("icacls.exe", [fixture_root, "/inheritance:r"]);
}

test("Windows SRT confines writes inside an ACL-hardened fixture", {
  skip: process.platform !== "win32" || process.env.DC_WINDOWS_SRT_INTEGRATION !== "1",
  timeout: 180_000,
}, async () => {
  const fixture_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-win-srt-"));
  const project_root = path.join(fixture_root, "project");
  const outside_path = path.join(fixture_root, "outside.txt");
  const state = createShellRuntimeState();
  const sandbox = new WindowsSrtSandbox();
  try {
    await fs.mkdir(project_root, { recursive: true });
    await harden_fixture_acl(fixture_root);
    const escaped_path = outside_path.replaceAll("%", "%%");
    const command = [
      "echo %WINDOWS_TEST_VALUE%",
      "node -e \"process.stdout.write('node-ok')\"",
      "echo allowed>inside.txt",
      `echo denied>\"${escaped_path}\"`,
    ].join(" && ");
    const execute_result = await execShellCommand(state, {
      sandbox,
      rootPath: project_root,
      dataPath: fixture_root,
      env: { WINDOWS_TEST_VALUE: "downcity" },
    }, {
      cmd: command,
      sandbox: "safe",
      timeoutMs: 120_000,
    });
    assert.equal(execute_result.shell.status, "failed", execute_result.chunk.output);
    assert.match(execute_result.chunk.output, /downcity/i);
    assert.match(execute_result.chunk.output, /node-ok/i);
    assert.equal(
      (await fs.readFile(path.join(project_root, "inside.txt"), "utf8")).trim(),
      "allowed",
    );
    assert.equal(execute_result.shell.sandboxBackend, "windows-srt-alpha");
    await assert.rejects(fs.access(outside_path));
  } finally {
    await closeAllShellSessions(state, true);
    await sandbox.dispose();
    await fs.rm(fixture_root, { recursive: true, force: true });
  }
});
