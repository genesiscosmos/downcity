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
  Workspace,
  initializeAgentProject,
  resolve_workspace_env,
} from "../bin/index.js";

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
    const agent = new Agent({
      id: "sdk_id",
      workspace: new Workspace({ path: project_root }),
    });
    assert.equal(agent.id, "sdk_id");
    assert.equal(agent.getContext().agent_id, "sdk_id");
    assert.equal(agent.getContext().rootPath, fs.realpathSync(project_root));
    await agent.ready();
    await agent.dispose();
  } finally {
    fs.rmSync(project_root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test("项目初始化只创建 .env、Skills 和运行目录并返回真实结果", async () => {
  const project_root = create_project_root();
  try {
    const first = await initializeAgentProject({
      projectRoot: project_root,
      id: "init_agent",
      execution: { type: "api", modelId: "model_a" },
    });
    assert.equal(fs.existsSync(path.join(project_root, ".env")), true);
    assert.equal(fs.existsSync(path.join(project_root, ".env.example")), false);
    assert.equal(fs.existsSync(path.join(project_root, ".agents", "skills")), true);
    assert.equal(first.createdFiles.includes(".env"), true);
    assert.equal(first.createdFiles.includes(".agents/skills/"), true);
    assert.equal(first.createdFiles.includes(".downcity/"), true);
    const gitignore = fs.readFileSync(path.join(project_root, ".gitignore"), "utf8");
    assert.match(gitignore, /^\.env$/m);
    assert.match(gitignore, /^\.downcity$/m);

    const second = await initializeAgentProject({
      projectRoot: project_root,
      id: "init_agent",
      execution: { type: "api", modelId: "model_a" },
    });
    assert.equal(second.skippedFiles.includes(".env"), true);
    assert.equal(second.skippedFiles.includes(".agents/skills/"), true);
    assert.equal(second.skippedFiles.includes(".downcity/"), true);
  } finally {
    fs.rmSync(project_root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
