/**
 * @file 验证 Workspace 动态 env 会进入持久 Sandbox。
 *
 * 关键点（中文）
 * - 测试编译后的 package 入口，确保 SDK 用户拿到的行为与源码一致。
 * - 只允许 Workspace env 中显式存在的 key 进入 Sandbox，不继承完整宿主环境。
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Agent } from "@downcity/agent";
import { Workspace, Shell } from "@downcity/city";
import { create_test_sandbox_provider } from "./PlatformSandbox.mjs";

async function execute_shell(workspace, cmd) {
  // shell 不再并进 Workspace tools；模型面由 City 的 `shell` power 暴露，
  // 这里直接驱动 Shell 持有的工具以验证 env 进入 Sandbox。
  const result = await workspace.shell.tools.shell_exec.execute(
    {
      cmd,
      shell: "/bin/sh",
      login: false,
      timeout_ms: 5000,
      target: "sandbox",
    },
    { toolCallId: "agent-env-shell-sandbox-test" },
  );
  assert.equal(result.success, true, result.error || result.output);
  return String(result.output || "");
}

test("workspace set_env and patch_env are visible in its Sandbox", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-env-"));
  const previous_host_value = process.env.HOST_ONLY_ENV_REPRO;
  process.env.HOST_ONLY_ENV_REPRO = "host_secret";

  const workspace = new Workspace({ id: "test_workspace",
    path: root_path,
    shell: new Shell({
      sandbox_provider: create_test_sandbox_provider(),
    }),
    runtime_path: path.join(root_path, "runtime"),
  });
  const agent = new Agent({ id: "agent-env-shell-sandbox-test" });

  try {
    workspace.set_env({
      DYNAMIC_ENV_REPRO: "initial_value",
      DC_DYNAMIC_REPRO: "dc_initial",
      REMOVED_ENV_REPRO: "remove_me",
    });

    const first_output = await execute_shell(
      workspace,
      'printf "CURRENT=%s\\nDC=%s\\nREMOVED=%s\\nHOST_ONLY=%s\\n" "$DYNAMIC_ENV_REPRO" "$DC_DYNAMIC_REPRO" "$REMOVED_ENV_REPRO" "$HOST_ONLY_ENV_REPRO"',
    );
    assert.match(first_output, /CURRENT=initial_value/);
    assert.match(first_output, /DC=dc_initial/);
    assert.match(first_output, /REMOVED=remove_me/);
    assert.match(first_output, /HOST_ONLY=\n/);

    workspace.patch_env({
      DYNAMIC_ENV_REPRO: "updated_value",
      ADDED_ENV_REPRO: "added_value",
      REMOVED_ENV_REPRO: null,
    });

    const second_output = await execute_shell(
      workspace,
      'printf "CURRENT=%s\\nADDED=%s\\nREMOVED=%s\\nHOST_ONLY=%s\\n" "$DYNAMIC_ENV_REPRO" "$ADDED_ENV_REPRO" "$REMOVED_ENV_REPRO" "$HOST_ONLY_ENV_REPRO"',
    );
    assert.match(second_output, /CURRENT=updated_value/);
    assert.match(second_output, /ADDED=added_value/);
    assert.match(second_output, /REMOVED=\n/);
    assert.match(second_output, /HOST_ONLY=\n/);
  } finally {
    await agent.dispose();
    await fs.rm(root_path, { recursive: true, force: true });
    if (previous_host_value === undefined) {
      delete process.env.HOST_ONLY_ENV_REPRO;
    } else {
      process.env.HOST_ONLY_ENV_REPRO = previous_host_value;
    }
  }
});
