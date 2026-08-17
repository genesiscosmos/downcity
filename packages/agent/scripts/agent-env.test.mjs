/**
 * Agent 项目环境变量装配测试。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  Agent,
} from "../bin/index.js";
import { Workspace, resolve_workspace_env } from "@downcity/workspace";

function create_project_root() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "downcity-agent-env-"));
}

test("Workspace 显式 env 覆盖项目 .env 且不修改 process.env", () => {
  const project_root = create_project_root();
  const original_value = process.env.DOWNCITY_ENV_TEST;
  try {
    fs.writeFileSync(
      path.join(project_root, ".env"),
      "DOWNCITY_ENV_TEST=project\nPROJECT_ONLY=value\n",
    );
    const env = resolve_workspace_env(project_root, {
      DOWNCITY_ENV_TEST: "host",
      HOST_ONLY: "value",
    });
    assert.equal(env.DOWNCITY_ENV_TEST, "host");
    assert.equal(env.HOST_ONLY, "value");
    assert.equal(env.PROJECT_ONLY, "value");
    assert.equal(process.env.DOWNCITY_ENV_TEST, original_value);
  } finally {
    fs.rmSync(project_root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("Agent 运行时只使用显式 id，不读取完整项目 config", async () => {
  const project_root = create_project_root();
  try {
    fs.writeFileSync(path.join(project_root, "downcity.json"), JSON.stringify({
      id: "legacy_id",
      version: "9.9.9",
    }));
    const agent = new Agent({ id: "sdk_id" });
    const entry = agent.enter(new Workspace({ id: "test_workspace", path: project_root, data_root_path: path.join(project_root, "data") }));
    assert.equal(agent.id, "sdk_id");
    assert.equal(entry.workspace.path, fs.realpathSync(project_root));
    await entry.sessions.create({ session_id: "env_runtime" });
    await agent.dispose();
  } finally {
    fs.rmSync(project_root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
