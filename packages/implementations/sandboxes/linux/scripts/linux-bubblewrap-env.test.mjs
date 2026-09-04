/** @file 验证 Linux Bubblewrap adapter 的环境收敛。 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build_linux_sandbox_env, LinuxBubblewrapSandbox } from "../bin/index.js";

test("Bubblewrap environment converges HOME and temporary directories", () => {
  const root_path = "/tmp/downcity-linux-sandbox/project";
  const sandbox_dir = path.join(root_path, ".downcity", "sandbox");
  const request = {
    execution_id: "sh_test", execution_dir: path.join(root_path, ".downcity", "shell", "sh_test"),
    cmd: "printf hello", cwd: root_path, shell_path: "/bin/sh", login: false,
    base_env: { PATH: "/usr/bin:/bin", HOST_SECRET: "hidden" },
    policy: {
      backend: "linux-bubblewrap", root_path, sandbox_dir, home_dir: sandbox_dir,
      tmp_dir: path.join(sandbox_dir, "tmp"), cache_dir: path.join(sandbox_dir, ".cache"),
      env_allowlist: ["PATH"], read_only_paths: ["/usr", "/bin"],
      read_write_paths: [root_path], network_mode: "full", fingerprint: "policy_test",
    },
  };
  const env = build_linux_sandbox_env(request);
  assert.equal(env.HOME, request.policy.home_dir);
  assert.equal(env.TMPDIR, request.policy.tmp_dir);
  assert.equal(env.HOST_SECRET, undefined);
});

test("Linux adapter reports a stable backend", async () => {
  const result = await new LinuxBubblewrapSandbox().preflight();
  assert.equal(result.backend, "linux-bubblewrap");
});
