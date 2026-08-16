/** 验证本地数据库 Adapter 与产品 Repository 的职责边界。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LocalCrypto,
  LocalDatabase,
} from "../bin/index.js";
import {
  AgentRepository,
  ensure_local_schema,
  resolve_local_agent_env,
  SecureSettingRepository,
  WorkspaceRepository,
} from "../bin/product.js";

/** 创建临时本地数据依赖。 */
async function create_local_data() {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-local-data-"));
  const database = new LocalDatabase({ filename: path.join(root_path, "downcity.db") });
  return { root_path, database };
}

test("LocalDatabase 不会隐式创建产品业务表", async () => {
  const { root_path, database } = await create_local_data();
  try {
    const before = database.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    });
    assert.deepEqual(before.rows, []);

    ensure_local_schema(database);
    const after = database.query({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    });
    assert.equal(after.rows.some((row) => row.name === "managed_agents"), false);
    assert.equal(after.rows.some((row) => row.name === "workspaces"), true);
  } finally {
    database.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("AgentRepository 与 WorkspaceRepository 独立维护产品配置", async () => {
  const { root_path, database } = await create_local_data();
  try {
    ensure_local_schema(database);
    const crypto_adapter = new LocalCrypto(root_path);
    const workspaces = new WorkspaceRepository(database, crypto_adapter);
    const agents = new AgentRepository(root_path);

    const workspace = workspaces.ensure({ workspace_path: path.join(root_path, "project") });
    const agent = agents.create({
      agent_id: "Lucas Whitman",
      execution: { type: "api", model_id: "model-test" },
      instruction: "You are Lucas.",
    });

    assert.equal(agents.get("lucas_whitman")?.instruction, "You are Lucas.");
    assert.equal(workspaces.get(workspace.workspace_id)?.workspace_path, workspace.workspace_path);
    assert.deepEqual(agents.list().map((item) => item.agent_id), ["lucas_whitman"]);
    assert.equal(await fs.readFile(
      path.join(root_path, "agents", "lucas_whitman", "instruction.md"),
      "utf8",
    ), "You are Lucas.");
  } finally {
    database.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("LocalDatabase transaction 提交同步写入并回滚异步回调", async () => {
  const { root_path, database } = await create_local_data();
  try {
    database.execute_script("CREATE TABLE values_test (value TEXT NOT NULL);");
    database.transaction((transaction) => {
      transaction.execute({ sql: "INSERT INTO values_test (value) VALUES (?);", params: ["sync"] });
    });
    assert.deepEqual(
      database.query({ sql: "SELECT value FROM values_test ORDER BY value;" }).rows,
      [{ value: "sync" }],
    );

    assert.throws(
      () => database.transaction(async (transaction) => {
        transaction.execute({ sql: "INSERT INTO values_test (value) VALUES (?);", params: ["async"] });
      }),
      /must be synchronous/u,
    );
    assert.deepEqual(
      database.query({ sql: "SELECT value FROM values_test ORDER BY value;" }).rows,
      [{ value: "sync" }],
    );
  } finally {
    database.close();
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("Agent Env 优先级为 Global < Workspace < 显式进程 Env", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-env-priority-"));
  const workspace_path = path.join(root_path, "workspace");
  await fs.mkdir(workspace_path);
  try {
    await fs.writeFile(
      path.join(root_path, ".env"),
      "SHARED=global\nGLOBAL_ONLY=yes\nDOWNCITY_USER_TOKEN=global-token\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspace_path, ".env"),
      "SHARED=workspace\nWORKSPACE_ONLY=yes\n",
      "utf8",
    );
    const env = resolve_local_agent_env({
      root_path,
      workspace_path,
      process_env: {
        SHARED: "process",
        PROCESS_ONLY: "yes",
        DOWNCITY_USER_TOKEN: "process-token",
      },
    });
    assert.equal(env.SHARED, "process");
    assert.equal(env.GLOBAL_ONLY, "yes");
    assert.equal(env.WORKSPACE_ONLY, "yes");
    assert.equal(env.PROCESS_ONLY, "yes");
    assert.equal(env.DOWNCITY_USER_TOKEN, "process-token");
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});

test("平台身份凭证不会从全局 Env 泄漏到 Agent Workspace", async () => {
  const root_path = await fs.mkdtemp(path.join(os.tmpdir(), "downcity-env-isolation-"));
  const workspace_path = path.join(root_path, "workspace");
  await fs.mkdir(workspace_path);
  try {
    await fs.writeFile(
      path.join(root_path, ".env"),
      [
        "SAFE_VALUE=kept",
        "DC_AUTH_TOKEN=auth-token",
        "DC_AGENT_TOKEN=agent-token",
        "DOWNCITY_FEDERATION_URL=https://federation.example.com",
        "DOWNCITY_USER_TOKEN=user-token",
        "DOWNCITY_CITY_URL=https://legacy.example.com",
        "DOWNCITY_CITY_USER_TOKEN=legacy-user-token",
        "CITY_URL=https://older.example.com",
        "CITY_USER_TOKEN=older-user-token",
      ].join("\n"),
      "utf8",
    );
    const env = resolve_local_agent_env({
      root_path,
      workspace_path,
      process_env: {},
    });
    assert.deepEqual(env, { SAFE_VALUE: "kept" });
  } finally {
    await fs.rm(root_path, { recursive: true, force: true });
  }
});
