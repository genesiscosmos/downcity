/** @file 验证 macOS Seatbelt adapter 的策略编译与环境收敛。 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  build_macos_sandbox_env,
  build_macos_seatbelt_profile,
  MacOsSeatbeltSandbox,
} from "../bin/index.js";

function create_request() {
  const root_path = "/tmp/downcity-macos-sandbox/project";
  const sandbox_dir = path.join(root_path, ".downcity", "sandbox");
  return {
    execution_id: "sh_test",
    execution_dir: path.join(root_path, ".downcity", "shell", "sh_test"),
    cmd: "printf hello",
    cwd: root_path,
    shell_path: "/bin/zsh",
    login: true,
    base_env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOST_SECRET: "hidden" },
    policy: {
      backend: "macos-seatbelt", root_path, sandbox_dir,
      home_dir: sandbox_dir, tmp_dir: path.join(sandbox_dir, "tmp"),
      cache_dir: path.join(sandbox_dir, ".cache"), env_allowlist: ["PATH", "LANG"],
      read_only_paths: ["/usr", "/bin"], read_write_paths: [root_path],
      network_mode: "full", fingerprint: "policy_test",
    },
  };
}

test("Seatbelt profile keeps read-only and writable paths distinct", () => {
  const profile = build_macos_seatbelt_profile(create_request());
  assert.match(profile, /allow file-read\*/);
  assert.match(profile, /allow file-write\*/);
  assert.doesNotMatch(profile, /file-write\* \(subpath "\/usr"\)/);
});

test("Seatbelt environment converges HOME and temporary directories", () => {
  const request = create_request();
  const env = build_macos_sandbox_env(request);
  assert.equal(env.HOME, request.policy.home_dir);
  assert.equal(env.TMPDIR, request.policy.tmp_dir);
  assert.equal(env.DC_SANDBOX_CACHE, request.policy.cache_dir);
  assert.equal(env.HOST_SECRET, undefined);
});

test("macOS adapter reports a stable backend", async () => {
  const sandbox = new MacOsSeatbeltSandbox();
  const result = await sandbox.preflight();
  assert.equal(result.backend, "macos-seatbelt");
  assert.equal(result.platform, process.platform);
});
