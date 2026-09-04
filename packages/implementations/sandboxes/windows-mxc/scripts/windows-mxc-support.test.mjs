/**
 * @file 验证 Windows MXC Development 后端的宿主支持判定。
 *
 * 关键点（中文）
 * - 测试只消费纯函数，不要求当前宿主运行 Windows。
 * - Windows build、runtime 可用性与 isolation tier 缺一不可。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluate_windows_mxc_support,
  parse_windows_build,
} from "../bin/WindowsMxcSupport.js";

function create_platform_support(overrides = {}) {
  return {
    isSupported: true,
    availableMethods: ["processcontainer"],
    isolationTier: "appcontainer-dacl",
    ...overrides,
  };
}

test("Windows release parser extracts the build number", () => {
  assert.equal(parse_windows_build("10.0.26100"), 26100);
  assert.equal(parse_windows_build("10.0.26100.4202"), 26100);
  assert.equal(parse_windows_build("invalid"), null);
});

test("MXC support accepts Windows 11 24H2 with a process isolation tier", () => {
  assert.deepEqual(evaluate_windows_mxc_support({
    windows_build: 26100,
    platform_support: create_platform_support(),
  }), {
    supported: true,
    windows_build: 26100,
    isolation_tier: "appcontainer-dacl",
    warnings: [],
  });
});

test("MXC support rejects old Windows builds", () => {
  const result = evaluate_windows_mxc_support({
    windows_build: 22631,
    platform_support: create_platform_support(),
  });
  assert.equal(result.supported, false);
  assert.match(result.reason, /26100/);
});

test("MXC support rejects a probe without a usable isolation tier", () => {
  const result = evaluate_windows_mxc_support({
    windows_build: 26100,
    platform_support: create_platform_support({ isolationTier: undefined }),
  });
  assert.equal(result.supported, false);
  assert.match(result.reason, /isolation tier/);
});
