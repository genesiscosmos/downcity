/**
 * @file 验证 City Global/Workspace Env 文件存储与优先级。
 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  delete_env_file_value,
  read_env_file,
  set_env_file_value,
} from "../bin/city/env/EnvFileStore.js";
import { create_agent_config } from "../bin/city/process/registry/AgentConfigRepository.js";
import { create_workspace } from "../bin/city/process/registry/WorkspaceRepository.js";
import {
  resolve_agent_env_target,
  set_env_target_value,
} from "../bin/city/env/EnvService.js";

test("Env 文件修改保留注释并消除目标 key 的重复声明", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-env-file-"));
  const file_path = path.join(root, ".env");
  try {
    await fs.writeFile(file_path, "# user comment\nKEEP=value\nTARGET=old\nTARGET=duplicate\n", "utf8");
    await set_env_file_value({ file_path, key: "target", value: "new value" });
    const content = await fs.readFile(file_path, "utf8");
    assert.match(content, /# user comment/u);
    assert.match(content, /KEEP=value/u);
    assert.equal((content.match(/^TARGET=/gmu) || []).length, 1);
    assert.equal((await read_env_file(file_path)).TARGET, "new value");
    assert.equal(await delete_env_file_value({ file_path, key: "TARGET" }), true);
    assert.equal((await read_env_file(file_path)).TARGET, undefined);
    assert.equal((await read_env_file(file_path)).KEEP, "value");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Agent Env 写入 Workspace，City 未运行时不产生广播目标", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-agent-env-target-"));
  const workspace_path = path.join(root, "workspace");
  await fs.mkdir(workspace_path);
  const previous_platform_root = process.env.DC_PLATFORM_ROOT;
  process.env.DC_PLATFORM_ROOT = path.join(root, "platform");
  try {
    const workspace = create_workspace({ workspace_path });
    create_agent_config({
      agent_id: "env_target_agent",
      workspace_id: workspace.workspace_id,
      version: "1.0.0",
    });
    const target = await resolve_agent_env_target("env_target_agent");
    const result = await set_env_target_value(target, "agent_key", "agent value");
    assert.equal((await read_env_file(path.join(workspace_path, ".env"))).AGENT_KEY, "agent value");
    assert.deepEqual(result.broadcast.updated_agent_ids, []);
    assert.deepEqual(result.broadcast.failed_agents, []);
  } finally {
    if (previous_platform_root === undefined) delete process.env.DC_PLATFORM_ROOT;
    else process.env.DC_PLATFORM_ROOT = previous_platform_root;
    await fs.rm(root, { recursive: true, force: true });
  }
});
