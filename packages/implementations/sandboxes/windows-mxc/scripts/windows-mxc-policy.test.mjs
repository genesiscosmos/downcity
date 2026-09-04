/**
 * @file 验证 Downcity 策略到 Microsoft MXC policy 的映射。
 *
 * 关键点（中文）
 * - 测试不启动原生 runtime，可在所有 CI 平台执行。
 * - 文件根目录、网络模式和环境变量必须保持显式白名单语义。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  build_windows_mxc_config,
  build_windows_mxc_env,
  build_windows_mxc_policy,
} from "../bin/WindowsMxc.js";
import { read_windows_env_value } from "../bin/WindowsEnvironment.js";

function with_platform(platform, callback) {
  const previous = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { configurable: true, value: platform });
  try {
    return callback();
  } finally {
    if (previous) Object.defineProperty(process, "platform", previous);
  }
}

function create_request(network_mode = "off") {
  return {
    execution_id: "exec-1",
    execution_dir: "C:\\repo\\.downcity\\execution",
    cmd: "echo ok",
    cwd: "C:\\repo",
    shell_path: "C:\\Windows\\System32\\cmd.exe",
    login: false,
    base_env: {
      Path: "C:\\Program Files\\nodejs;C:\\Windows\\System32",
      SECRET: "hidden",
      EXPLICIT: "visible",
      DC_TRACE: "enabled",
      SystemRoot: "C:\\Windows",
    },
    policy: {
      backend: "windows-mxc-dev",
      root_path: "C:\\repo",
      sandbox_dir: "C:\\repo\\.downcity\\sandbox",
      home_dir: "C:\\repo\\.downcity\\sandbox",
      tmp_dir: "C:\\repo\\.downcity\\sandbox\\tmp",
      cache_dir: "C:\\repo\\.downcity\\sandbox\\.cache",
      env_allowlist: ["PATH", "EXPLICIT", "SystemRoot"],
      read_only_paths: ["C:\\Windows\\System32"],
      read_write_paths: ["C:\\repo"],
      network_mode,
      fingerprint: "policy-1",
    },
  };
}

test("Windows MXC policy preserves filesystem roots and defaults network off", () => {
  assert.deepEqual(build_windows_mxc_policy(create_request()), {
    version: "0.7.0-alpha",
    filesystem: {
      readonlyPaths: ["C:\\Windows\\System32"],
      readwritePaths: ["C:\\repo"],
      clearPolicyOnExit: true,
    },
    network: {
      allowOutbound: false,
      allowLocalNetwork: false,
    },
    ui: {
      allowWindows: true,
      clipboard: "none",
      allowInputInjection: false,
    },
  });
});

test("Windows MXC policy grants coarse network access only for full mode", () => {
  assert.deepEqual(build_windows_mxc_policy(create_request("full")).network, {
    allowOutbound: true,
    allowLocalNetwork: true,
  });
});

test("Windows MXC config uses process containment and native cmd invocation", () => {
  with_platform("win32", () => {
    const config = build_windows_mxc_config(create_request());
    assert.equal(config.containment, "process");
    assert.equal(config.process.cwd, "C:\\repo");
    assert.equal(
      config.process.commandLine,
      "C:\\Windows\\System32\\cmd.exe /d /s /c \"echo ok\"",
    );
  });
});

test("Windows MXC environment excludes unapproved host variables", () => {
  const env = build_windows_mxc_env(create_request());
  assert.equal(env.PATH, "C:\\Program Files\\nodejs;C:\\Windows\\System32");
  assert.equal(env.EXPLICIT, "visible");
  assert.equal(env.SECRET, undefined);
  assert.equal(env.DC_TRACE, "enabled");
  assert.equal(env.COMSPEC, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(env.TEMP, "C:\\repo\\.downcity\\sandbox\\tmp");
});

test("Windows environment lookup is case-insensitive", () => {
  assert.equal(
    read_windows_env_value({ Path: "C:\\Program Files\\nodejs" }, "PATH"),
    "C:\\Program Files\\nodejs",
  );
});
