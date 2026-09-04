/**
 * @file 验证 Downcity 策略到 Anthropic SRT 配置的映射。
 *
 * 关键点（中文）：测试不启动 Windows helper，可在所有 CI 平台执行。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  WINDOWS_SRT_DEFAULT_PROXY_PORT_RANGE,
  WINDOWS_SRT_DEFAULT_SUBLAYER_GUID,
  WINDOWS_SRT_DEFAULT_USER,
  build_windows_srt_config,
} from "../bin/index.js";

function create_request(network_mode = "off") {
  return {
    execution_id: "exec-1",
    execution_dir: "C:\\repo\\.downcity\\execution",
    cmd: "echo ok",
    cwd: "C:\\repo",
    shell_path: "C:\\Windows\\System32\\cmd.exe",
    login: false,
    base_env: {},
    policy: {
      backend: "windows-srt-alpha",
      root_path: "C:\\repo",
      sandbox_dir: "C:\\repo\\.downcity\\sandbox",
      home_dir: "C:\\repo\\.downcity\\sandbox",
      tmp_dir: "C:\\repo\\.downcity\\sandbox\\tmp",
      cache_dir: "C:\\repo\\.downcity\\sandbox\\.cache",
      env_allowlist: [],
      read_only_paths: ["C:\\Windows\\System32", "C:\\private-tools"],
      host_read_only_paths: ["C:\\private-tools"],
      read_write_paths: ["C:\\repo"],
      network_mode,
      fingerprint: "policy-1",
    },
  };
}

test("Windows SRT writes ACL only for host-approved private paths", () => {
  const config = build_windows_srt_config(create_request());
  assert.deepEqual(config.filesystem, {
    denyRead: [],
    allowRead: ["C:\\private-tools"],
    allowWrite: ["C:\\repo"],
    denyWrite: [],
  });
  assert.deepEqual(config.network, {
    allowedDomains: [],
    deniedDomains: [],
  });
  assert.equal(config.windows.sandboxUser, WINDOWS_SRT_DEFAULT_USER);
  assert.equal(config.windows.sublayerGuid, WINDOWS_SRT_DEFAULT_SUBLAYER_GUID);
  assert.deepEqual(
    config.windows.proxyPortRange,
    [...WINDOWS_SRT_DEFAULT_PROXY_PORT_RANGE],
  );
});

test("Windows SRT full network mode maps to an explicit wildcard", () => {
  const config = build_windows_srt_config(create_request("full"));
  assert.deepEqual(config.network.allowedDomains, ["*"]);
});
