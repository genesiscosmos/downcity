/** 验证本地数据库 Adapter 与产品 Repository 的职责边界。 */

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AgentRepository,
  ensure_local_schema,
  LocalCrypto,
  LocalDatabase,
  SecureSettingRepository,
  WorkspaceRepository,
} from "../bin/index.js";

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
    assert.equal(after.rows.some((row) => row.name === "managed_agents"), true);
    assert.equal(after.rows.some((row) => row.name === "workspaces"), true);
    const agent_columns = database.query({ sql: "PRAGMA table_info(managed_agents);" });
    assert.equal(
      agent_columns.rows.find((column) => column.name === "workspace_id")?.notnull,
      1,
    );
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
    const agents = new AgentRepository(database, crypto_adapter, workspaces);

    const workspace = workspaces.ensure({ workspace_path: path.join(root_path, "project") });
    const agent = agents.create({
      agent_id: "Lucas Whitman",
      workspace_id: workspace.workspace_id,
      execution: { type: "api", model_id: "model-test" },
    });

    assert.equal(agents.get("lucas_whitman")?.workspace_id, workspace.workspace_id);
    assert.equal(workspaces.get(workspace.workspace_id)?.workspace_path, workspace.workspace_path);
    assert.deepEqual(agents.list().map((item) => item.agent_id), ["lucas_whitman"]);
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
