/**
 * @file 验证 Linux Bubblewrap 参数对统一 Sandbox 策略的映射。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { build_linux_bubblewrap_args } from "../bin/LinuxBubblewrap.js";

function has_option_pair(args, option, source_path, target_path = source_path) {
  for (let index = 0; index < args.length - 2; index += 1) {
    if (
      args[index] === option &&
      args[index + 1] === source_path &&
      args[index + 2] === target_path
    ) return true;
  }
  return false;
}

test("Linux maps read paths to ro-bind and workspace to bind", async () => {
  const fixture_root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-bwrap-"));
  try {
    const project_root = path.join(fixture_root, "project");
    const tool_root = path.join(fixture_root, "tool");
    await fs.mkdir(project_root, { recursive: true });
    await fs.mkdir(tool_root, { recursive: true });
    const request = {
      execution_id: "sh_test",
      execution_dir: path.join(project_root, ".downcity", "shell", "sh_test"),
      cmd: "printf hello",
      cwd: project_root,
      shell_path: "/bin/sh",
      login: true,
      base_env: { PATH: "/usr/bin:/bin" },
      policy: {
        backend: "linux-bubblewrap",
        root_path: project_root,
        sandbox_dir: path.join(project_root, ".downcity", "sandbox"),
        home_dir: path.join(project_root, ".downcity", "sandbox"),
        tmp_dir: path.join(project_root, ".downcity", "sandbox", "tmp"),
        cache_dir: path.join(project_root, ".downcity", "sandbox", ".cache"),
        env_allowlist: ["PATH"],
        read_only_paths: [tool_root],
        read_write_paths: [project_root],
        network_mode: "off",
        fingerprint: "policy_test",
      },
    };
    const args = build_linux_bubblewrap_args(request);
    assert.equal(args.includes("--unshare-net"), true);
    assert.equal(has_option_pair(args, "--ro-bind", tool_root), true);
    assert.equal(has_option_pair(args, "--bind", tool_root), false);
    assert.equal(has_option_pair(args, "--bind", project_root), true);
    assert.deepEqual(args.slice(-5), [
      "--chdir",
      project_root,
      "/bin/sh",
      "-lc",
      "printf hello",
    ]);
  } finally {
    await fs.rm(fixture_root, { recursive: true, force: true });
  }
});
