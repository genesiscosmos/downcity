/**
 * @file 验证 Windows SRT 环境白名单与 broker argv 注入。
 *
 * 关键点（中文）：用户变量不能覆盖 SRT 生成的代理或 Git 安全配置。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  build_windows_srt_env,
  inject_windows_srt_env,
} from "../bin/index.js";

function create_request() {
  return {
    shell_path: "C:\\Windows\\System32\\cmd.exe",
    base_env: {
      Path: "C:\\Program Files\\nodejs;C:\\Windows\\System32",
      EXPLICIT: "visible",
      SECRET: "hidden",
      DC_TRACE: "enabled",
      HTTP_PROXY: "http://host-proxy.invalid",
    },
    policy: {
      env_allowlist: ["PATH", "EXPLICIT", "HTTP_PROXY"],
      sandbox_dir: "C:\\repo\\.downcity\\sandbox",
      home_dir: "C:\\repo\\.downcity\\sandbox",
      tmp_dir: "C:\\repo\\.downcity\\sandbox\\tmp",
      cache_dir: "C:\\repo\\.downcity\\sandbox\\.cache",
    },
  };
}

test("Windows SRT environment exports only approved and runtime values", () => {
  const env = build_windows_srt_env(create_request());
  assert.equal(env.PATH, "C:\\Program Files\\nodejs;C:\\Windows\\System32");
  assert.equal(env.EXPLICIT, "visible");
  assert.equal(env.DC_TRACE, "enabled");
  assert.equal(env.SECRET, undefined);
  assert.equal(env.HTTP_PROXY, undefined);
  assert.equal(env.TEMP, "C:\\repo\\.downcity\\sandbox\\tmp");
});

test("Windows SRT argv injection preserves runtime proxy variables", () => {
  const argv = [
    "C:\\runtime\\srt-win.exe",
    "exec",
    "--quiet",
    "--env",
    "PATH=host-path",
    "--env",
    "HTTP_PROXY=http://srt-proxy",
    "--",
    "cmd.exe",
    "/d",
    "/s",
    "/c",
    "echo ok",
  ];
  const result = inject_windows_srt_env(argv, {
    PATH: "approved-path",
    EXPLICIT: "visible",
  });
  assert.equal(result.filter((value) => value === "PATH=host-path").length, 0);
  assert.equal(result.filter((value) => value === "PATH=approved-path").length, 1);
  assert.equal(result.filter((value) => value === "HTTP_PROXY=http://srt-proxy").length, 1);
  assert.ok(result.indexOf("EXPLICIT=visible") < result.indexOf("--"));
});
